import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { catchError, filter, from, fromEvent, interval, map, mergeMap, of } from 'rxjs';
import { branchLocation } from '../../config/branches';
import { environment } from '../../Environments/environment';
import { DeliveryOrder, OrderItem, OrderStatus } from '../../models/order.model';
import { ApiService } from '../../services/api.service';
import { AttendanceService } from '../../services/attendance.service';
import { OrderAlertService } from '../../services/order-alert.service';
import {
  coordinates,
  dialPhone,
  directionsUrl,
  formatClock,
  isMapLink,
  pickLocalized,
  unitNumber,
} from '../../utils/order-format';

type Tab = 'active' | 'done';

/** The API rate-limits bursts (HTTP 429), so day requests are fetched a couple at a time. */
const MAX_PARALLEL_REQUESTS = 2;
/** Live board refresh — status changes from the branch must show without a manual refresh. */
const POLL_MS = 4000;

const STATUS_ICONS: Record<number, string> = {
  [OrderStatus.Pending]: 'bi-hourglass-split',
  [OrderStatus.Confirmed]: 'bi-check2-circle',
  [OrderStatus.Shipped]: 'bi-truck',
  [OrderStatus.Delivered]: 'bi-check2-all',
  [OrderStatus.Canceled]: 'bi-x-circle',
  [OrderStatus.ReadyForPickup]: 'bi-shop',
};

@Component({
  selector: 'app-orders',
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.scss'],
})
export class OrdersComponent implements OnInit {
  readonly OrderStatus = OrderStatus;
  readonly skeletons = [0, 1, 2];
  checks: { label: string; value: string; ok?: boolean }[] = [];
  orders: DeliveryOrder[] = [];
  tab: Tab = 'active';
  loading = false;
  loadError = false;
  updatingId: number | null = null;
  menuOpenId: number | null = null;
  expandedId: number | null = null;

  private knownIds = new Set<number>();
  private knownStatus = new Map<number, number>();
  private primed = false;
  private inFlight = false;
  /** Owner-only diagnostics card, revealed by opening /orders?check. */
  readonly showCheck = new URLSearchParams(location.search).has('check');
  /** Dev-only: opening /orders?demo injects a local test order (negative id, never sent to the API). */
  private demoPending = !environment.production && new URLSearchParams(location.search).has('demo');
  private destroyRef = inject(DestroyRef);

  constructor(
    private api: ApiService,
    private translate: TranslateService,
    private toastr: ToastrService,
    public alerts: OrderAlertService,
    private attendance: AttendanceService
  ) {}

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => (document.body.style.overflow = ''));
    this.load(false);
    void this.attendance.checkIn();
    if (this.showCheck) this.checks = this.attendance.diagnostics();
    if (this.demoPending) {
      this.demoPending = false;
      this.scheduleDemoOrder();
    }
    interval(POLL_MS)
      .pipe(
        filter(() => this.updatingId == null && !this.inFlight),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.load(true));

    fromEvent(document, 'visibilitychange')
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.load(true));

    fromEvent(window, 'focus')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load(true));

    if (this.alerts.enabled) void this.alerts.push.sync();
    if ('serviceWorker' in navigator) {
      fromEvent<MessageEvent>(navigator.serviceWorker, 'message')
        .pipe(
          filter((event) => event.data?.type === 'order-push'),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(() => this.load(true));
    }
  }

  toggleAlerts(): void {
    if (this.alerts.enabled && !this.alerts.needsSetup) {
      this.alerts.disable();
      return;
    }
    void this.alerts.enable();
  }

  @HostListener('document:click')
  closeMenus(): void {
    this.menuOpenId = null;
  }

  /** The order currently opened in the full-screen sheet. */
  get selected(): DeliveryOrder | null {
    return this.orders.find((order) => order.id === this.expandedId) ?? null;
  }

  toggleExpand(order: DeliveryOrder, event?: Event): void {
    event?.stopPropagation();
    this.menuOpenId = null;
    this.setOpen(order.id);
  }

  @HostListener('document:keydown.escape')
  closeSheet(): void {
    this.setOpen(null);
  }

  private setOpen(id: number | null): void {
    this.expandedId = id;
    document.body.style.overflow = id == null ? '' : 'hidden';
  }

  get lang(): string {
    return this.translate.currentLang || 'ar';
  }

  get activeOrders(): DeliveryOrder[] {
    return this.orders.filter((order) => isOpen(order.status));
  }

  get doneOrders(): DeliveryOrder[] {
    return this.orders.filter((order) => !isOpen(order.status)).reverse();
  }

  get visible(): DeliveryOrder[] {
    return this.tab === 'active' ? this.activeOrders : this.doneOrders;
  }

  get todayLabel(): string {
    return new Intl.DateTimeFormat(this.lang === 'ar' ? 'ar-EG' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date());
  }

  get cashLeft(): number {
    return this.activeOrders.reduce((sum, order) => sum + (order.amountToCollect || 0), 0);
  }

  load(silent: boolean): void {
    if (this.inFlight) return;
    this.inFlight = true;
    if (!silent) {
      this.loading = true;
      this.loadError = false;
    }

    const today = toIso(new Date());
    // Only today's orders: the board starts fresh every day.
    this.orders = this.orders.filter((order) => order.id < 0 || order.createdAt.slice(0, 10) === today);
    const days = [today];
    let succeeded = 0;

    from(days)
      .pipe(
        mergeMap(
          (day) =>
            this.api.getOrdersByDate(day).pipe(
              map((rows): { day: string; rows: DeliveryOrder[] | null } => ({ day, rows })),
              catchError(() => of({ day, rows: null }))
            ),
          MAX_PARALLEL_REQUESTS
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ day, rows }) => {
          if (rows === null) return;
          succeeded++;
          this.mergeDay(day, rows);
        },
        complete: () => {
          this.inFlight = false;
          this.loading = false;
          this.primed = true;
          if (!silent) this.loadError = succeeded === 0 && !this.orders.length;
        },
      });
  }

  /** Browsers only allow sound and vibration after a tap, so the demo waits for one if needed. */
  private scheduleDemoOrder(): void {
    const fire = () => setTimeout(() => this.addDemoOrder(), 1500);
    if (this.alerts.audioReady) {
      fire();
      return;
    }
    this.toastr.info(this.translate.instant('orders.demoTapHint'), '', { timeOut: 6000 });
    document.addEventListener('pointerdown', fire, { once: true });
  }

  private addDemoOrder(): void {
    const order = buildDemoOrder(-Date.now());
    this.loadError = false;
    this.tab = 'active';
    this.orders = [...this.orders, order];
    this.announceNew([order]);
    this.knownIds.add(order.id);
  }

  /** Replaces one day's orders in place so each day shows up as soon as it arrives. */
  private mergeDay(day: string, rows: DeliveryOrder[]): void {
    if (this.primed) {
      this.announceNew(rows);
      this.announceStatusChanges(rows);
    }

    const incoming = rows.map((order) => {
      if (this.updatingId !== order.id) return order;
      const current = this.orders.find((item) => item.id === order.id);
      return current ? { ...order, status: current.status } : order;
    });
    for (const order of incoming) {
      this.knownIds.add(order.id);
      this.knownStatus.set(order.id, order.status);
    }
    const kept = this.orders.filter((order) => order.id < 0 || order.createdAt.slice(0, 10) !== day);
    this.orders = [...kept, ...incoming].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt)
    );
  }

  statusIcon(status: number): string {
    return STATUS_ICONS[status] ?? 'bi-circle';
  }

  isDelivery(order: DeliveryOrder): boolean {
    return (order.deliveryFee || 0) > 0 || !!(order.street || order.district || '').trim();
  }

  /** Order is not yet with the driver: next stop is the branch. */
  goingToBranch(order: DeliveryOrder): boolean {
    return (
      order.status === OrderStatus.Pending ||
      order.status === OrderStatus.Confirmed ||
      order.status === OrderStatus.ReadyForPickup
    );
  }

  /** Order is out for delivery: next stop is the customer. */
  onTheWay(order: DeliveryOrder): boolean {
    return order.status === OrderStatus.Shipped;
  }

  /** Driver may only set Out for Delivery or Delivered — confirm / ready / cancel stay with the branch. */
  primaryAction(order: DeliveryOrder): OrderStatus | null {
    if (!this.isDelivery(order)) return null;
    if (
      order.status === OrderStatus.Confirmed ||
      order.status === OrderStatus.ReadyForPickup
    ) {
      return OrderStatus.Shipped;
    }
    if (order.status === OrderStatus.Shipped) return OrderStatus.Delivered;
    return null;
  }

  otherActions(_order: DeliveryOrder): OrderStatus[] {
    return [];
  }

  toggleMenu(order: DeliveryOrder, event: Event): void {
    event.stopPropagation();
    this.menuOpenId = this.menuOpenId === order.id ? null : order.id;
  }

  requestStatus(order: DeliveryOrder, status: number): void {
    this.menuOpenId = null;
    if (status === order.status || this.updatingId != null) return;
    if (!this.canDriverSet(order, status)) return;
    this.applyStatus(order, status);
  }

  private canDriverSet(order: DeliveryOrder, status: number): boolean {
    if (!this.isDelivery(order)) return false;
    if (status === OrderStatus.Shipped) {
      return (
        order.status === OrderStatus.Confirmed ||
        order.status === OrderStatus.ReadyForPickup
      );
    }
    if (status === OrderStatus.Delivered) {
      return order.status === OrderStatus.Shipped;
    }
    return false;
  }

  clock(order: DeliveryOrder): string {
    return formatClock(order.createdAt);
  }

  dayLabel(order: DeliveryOrder): string {
    const iso = order.createdAt.slice(0, 10);
    if (iso === toIso(new Date())) return '';
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(this.lang === 'ar' ? 'ar-EG' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(year, month - 1, day));
  }

  street(order: DeliveryOrder): string {
    return (order.street || '').trim();
  }

  /** Just the neighbourhood — short enough for a phone-width card. */
  shortArea(order: DeliveryOrder): string {
    return (
      pickLocalized(this.lang, order.district, order.districtAr) ||
      pickLocalized(this.lang, order.city, order.cityAr) ||
      this.street(order)
    );
  }

  area(order: DeliveryOrder): string {
    return [
      pickLocalized(this.lang, order.district, order.districtAr),
      pickLocalized(this.lang, order.city, order.cityAr),
      pickLocalized(this.lang, order.governorate, order.governorateAr),
    ]
      .filter(Boolean)
      .join(this.lang === 'ar' ? '، ' : ', ');
  }

  /** Building / floor / apartment kept as separate chips so mixed Arabic-Latin values never reorder. */
  unitParts(order: DeliveryOrder): { label: string; value: string }[] {
    return [
      { label: 'orders.building', value: unitNumber(this.lang, order.buildingNumber) },
      { label: 'orders.floor', value: (order.floor || '').trim() },
      { label: 'orders.apartment', value: unitNumber(this.lang, order.apartment) },
    ]
      .map((part) => ({ label: this.translate.instant(part.label), value: part.value }))
      .filter((part) => part.value);
  }

  productName(orderItem: OrderItem): string {
    return pickLocalized(this.lang, orderItem.productName, orderItem.productNameAr);
  }

  variantName(orderItem: OrderItem): string {
    return pickLocalized(this.lang, orderItem.variantName, orderItem.variantNameAr);
  }

  itemCount(order: DeliveryOrder): number {
    return (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
  }

  initial(order: DeliveryOrder): string {
    return (order.fullName || '').trim().charAt(0).toUpperCase() || '؟';
  }

  /** Pin from the API > shared Maps link > Google's own search on the full typed address. */
  mapHref(order: DeliveryOrder): string {
    const pin = coordinates(order.latitude, order.longitude);
    if (pin) return directionsUrl(pin);
    if (isMapLink(order.locationUrl)) return order.locationUrl!.trim();
    return directionsUrl(customerAddressQuery(order));
  }

  /** The branch's own Google Maps page (name, photos, hours), falling back to directions. */
  branchPlaceHref(order: DeliveryOrder): string {
    if (isMapLink(order.branchLocationUrl)) return order.branchLocationUrl!.trim();
    return branchLocation(order)?.mapUrl ?? this.branchMapHref(order);
  }

  branchMapHref(order: DeliveryOrder): string {
    const pin = coordinates(order.branchLatitude, order.branchLongitude);
    if (pin) return directionsUrl(pin);
    if (isMapLink(order.branchLocationUrl)) return order.branchLocationUrl!.trim();
    const known = branchLocation(order);
    if (known) return directionsUrl(`${known.lat},${known.lng}`);
    const address = order.branchAddressAr || order.branchAddress;
    return directionsUrl(
      addressQuery(address ? [address] : ['Bubble Hope', order.branchNameAr || order.branchName])
    );
  }

  /** Route to the landmark next to the customer; null when the order has no landmark. */
  landmarkHref(order: DeliveryOrder): string | null {
    return (order.landmark || '').trim() ? directionsUrl(landmarkQuery(order)) : null;
  }

  hasExactPin(order: DeliveryOrder): boolean {
    return !!coordinates(order.latitude, order.longitude) || isMapLink(order.locationUrl);
  }

  branchName(order: DeliveryOrder): string {
    return pickLocalized(this.lang, order.branchName, order.branchNameAr);
  }

  branchAddress(order: DeliveryOrder): string {
    const known = branchLocation(order);
    return (
      pickLocalized(this.lang, order.branchAddress, order.branchAddressAr) ||
      pickLocalized(this.lang, known?.address, known?.addressAr)
    );
  }

  branchCallHref(order: DeliveryOrder): string {
    return `tel:${dialPhone(order.branchPhone ?? '')}`;
  }

  isCash(order: DeliveryOrder): boolean {
    return /cash|cod/i.test(order.paymentMethod || '');
  }

  paymentLabel(order: DeliveryOrder): string {
    if (this.isCash(order)) return this.translate.instant('orders.payment.cash');
    return order.paymentMethod?.trim() || this.translate.instant('orders.payment.online');
  }

  money(value: number): string {
    return new Intl.NumberFormat('en-EG', { maximumFractionDigits: 2 }).format(value || 0);
  }

  callHref(order: DeliveryOrder): string {
    return `tel:${dialPhone(order.phone)}`;
  }

  /** Every WhatsApp button opens the chat with the "please send me your location" message already typed. */
  whatsAppHref(order: DeliveryOrder): string {
    const text = this.translate.instant('orders.askLocationText', {
      name: (order.fullName || '').trim(),
      code: order.code,
    });
    return `https://wa.me/${dialPhone(order.phone).replace('+', '')}?text=${encodeURIComponent(text)}`;
  }

  /** WhatsApp chat pre-filled to ask the customer for their live location — the only exact pin we can get today. */
  askLocationHref(order: DeliveryOrder): string {
    return this.whatsAppHref(order);
  }

  trackById(_: number, order: DeliveryOrder): number {
    return order.id;
  }

  private applyStatus(order: DeliveryOrder, status: number): void {
    const previous = order.status;
    if (order.id < 0) {
      order.status = status;
      this.toastr.success(
        this.translate.instant('orders.updated', {
          code: order.code,
          status: this.translate.instant('orders.status.' + status),
        })
      );
      return;
    }
    this.updatingId = order.id;
    this.api.updateOrderStatus(order.id, status).subscribe({
      next: () => {
        order.status = status;
        this.updatingId = null;
        if (status === OrderStatus.Delivered && this.expandedId === order.id) this.setOpen(null);
        this.toastr.success(
          this.translate.instant('orders.updated', {
            code: order.code,
            status: this.translate.instant('orders.status.' + status),
          })
        );
      },
      error: (error: HttpErrorResponse) => {
        order.status = previous;
        this.updatingId = null;
        const fallback = this.translate.instant('orders.updateFailed');
        const body = error.error;
        const message =
          typeof body === 'string'
            ? body
            : this.lang === 'ar'
              ? body?.messageAr || body?.message
              : body?.message || body?.messageAr;
        this.toastr.error(typeof message === 'string' && message.trim() ? message : fallback);
      },
    });
  }

  private announceNew(rows: DeliveryOrder[]): void {
    const fresh = rows.filter((order) => !this.knownIds.has(order.id));
    if (!fresh.length) return;
    const text =
      fresh.length === 1
        ? this.translate.instant('orders.newOne', { code: fresh[0].code })
        : this.translate.instant('orders.newMany', { count: fresh.length });
    this.toastr.info(text, '', { timeOut: 4000 });
    this.alerts.notify(
      fresh.map((order) => ({
        id: order.id,
        title: this.translate.instant('alerts.newTitle', { code: order.code }),
        body: this.alertBody(order),
      }))
    );
  }

  /** Branch confirm / ready must ping the driver — they will not notice a quiet badge change. */
  private announceStatusChanges(rows: DeliveryOrder[]): void {
    const hits = rows.filter((order) => {
      const previous = this.knownStatus.get(order.id);
      if (previous === undefined || previous === order.status) return false;
      if (!this.isDelivery(order)) return false;
      return (
        order.status === OrderStatus.Confirmed ||
        order.status === OrderStatus.ReadyForPickup
      );
    });
    if (!hits.length) return;

    for (const order of hits) {
      const key =
        order.status === OrderStatus.ReadyForPickup ? 'orders.statusReady' : 'orders.statusConfirmed';
      this.toastr.success(this.translate.instant(key, { code: order.code }), '', { timeOut: 5000 });
    }
    this.alerts.notify(
      hits.map((order) => ({
        id: order.id,
        title: this.translate.instant(
          order.status === OrderStatus.ReadyForPickup ? 'alerts.readyTitle' : 'alerts.confirmedTitle',
          { code: order.code }
        ),
        body: this.alertBody(order),
      }))
    );
  }

  private alertBody(order: DeliveryOrder): string {
    return [
      order.fullName?.trim(),
      pickLocalized(this.lang, order.district, order.districtAr) ||
        pickLocalized(this.lang, order.city, order.cityAr),
      `${this.money(order.amountToCollect)} ${this.translate.instant('orders.currency')}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }
}

function buildDemoOrder(id: number): DeliveryOrder {
  const now = new Date();
  const clock = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  const deliveryFee = 30;
  const totalAmount = 245;
  return {
    id,
    code: `TEST-${String(Math.abs(id)).slice(-4)}`,
    createdAt: `${toIso(now)}T${clock}`,
    status: OrderStatus.Pending,
    fullName: 'عميل تجريبي',
    phone: '01000000000',
    governorate: 'Giza',
    governorateAr: 'الجيزة',
    city: 'Hadayek Al-Ahram',
    cityAr: 'حدائق الأهرام',
    district: '',
    districtAr: '',
    street: '',
    buildingNumber: '332 أ',
    floor: '',
    apartment: '',
    landmark: '',
    branchId: 2,
    branchName: 'Hadayek Al-Ahram',
    branchNameAr: 'حدائق الأهرام',
    branchAddress: null,
    branchAddressAr: null,
    branchPhone: null,
    totalAmount,
    deliveryFee,
    paymentMethod: 'Cash On Delivery',
    paymentStatus: 0,
    amountToCollect: totalAmount,
    items: [
      {
        productId: 1,
        productName: 'Brown Sugar Milk Tea Boba',
        productNameAr: 'شاي حليب السكر البني بوبا',
        quantity: 2,
        variantName: null,
        variantNameAr: null,
      },
    ],
  };
}

/**
 * Street + area only, Arabic first: "الثروة المعدنية، حدائق الأهرام، الجيزة، مصر".
 * Building / zone numbers are left out on purpose: Google guesses a different "building 44" somewhere
 * else, while the street itself lands in the right neighbourhood. The driver reads the building from the card.
 */
function customerAddressQuery(order: DeliveryOrder): string {
  const district = (order.districtAr || order.district || '').trim();
  const street = (order.street || '').trim();
  // The English street is often just the district retyped; the Arabic district already covers it.
  const letters = (text: string | null | undefined) => (text || '').toLowerCase().replace(/[^a-z\u0621-\u064A]/g, '');
  const sameAsDistrict = !!order.districtAr && !!street && letters(street) === letters(order.district);
  return addressQuery([
    sameAsDistrict ? '' : street,
    district,
    order.cityAr || order.city,
    order.governorateAr || order.governorate,
  ]);
}

/** The named place next to the customer (cafe, pharmacy…) — Google pins named places far more exactly than streets. */
function landmarkQuery(order: DeliveryOrder): string {
  return addressQuery([
    (order.landmark || '').trim(),
    (order.districtAr || order.district || '').trim(),
    order.cityAr || order.city,
    order.governorateAr || order.governorate,
  ]);
}

/** Arabic place names plus the country geocode far more reliably in Egypt than mixed-language text. */
function addressQuery(parts: (string | null | undefined)[]): string {
  const cleaned = [...new Set(parts.map((part) => (part || '').trim()).filter(Boolean))];
  return [...cleaned, 'مصر'].join('، ');
}

function isOpen(status: number): boolean {
  return status !== OrderStatus.Delivered && status !== OrderStatus.Canceled;
}

function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
