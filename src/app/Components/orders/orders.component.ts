import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, HostListener, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { ToastrService } from 'ngx-toastr';
import { catchError, filter, from, interval, map, mergeMap, of } from 'rxjs';
import { environment } from '../../Environments/environment';
import { DeliveryOrder, OrderItem, OrderStatus } from '../../models/order.model';
import { ApiService } from '../../services/api.service';
import { OrderAlertService } from '../../services/order-alert.service';
import {
  dialPhone,
  formatClock,
  pickLocalized,
} from '../../utils/order-format';

type Tab = 'active' | 'done';

/** Unfinished orders from the last two weeks stay on the driver's list until closed. */
const LOOKBACK_DAYS = 14;
/** The API rate-limits bursts (HTTP 429), so day requests are fetched a couple at a time. */
const MAX_PARALLEL_REQUESTS = 2;

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
  readonly statuses = [
    OrderStatus.Pending,
    OrderStatus.Confirmed,
    OrderStatus.ReadyForPickup,
    OrderStatus.Shipped,
    OrderStatus.Delivered,
    OrderStatus.Canceled,
  ];
  readonly skeletons = [0, 1, 2];
  orders: DeliveryOrder[] = [];
  tab: Tab = 'active';
  loading = false;
  loadError = false;
  updatingId: number | null = null;
  cancelPromptId: number | null = null;
  menuOpenId: number | null = null;

  private knownIds = new Set<number>();
  private primed = false;
  private inFlight = false;
  /** Dev-only: opening /orders?demo injects a local test order (negative id, never sent to the API). */
  private demoPending = !environment.production && new URLSearchParams(location.search).has('demo');
  private destroyRef = inject(DestroyRef);

  constructor(
    private api: ApiService,
    private translate: TranslateService,
    private toastr: ToastrService,
    public alerts: OrderAlertService
  ) {}

  ngOnInit(): void {
    this.load(false);
    interval(30000)
      .pipe(
        filter(() => this.updatingId == null && !this.inFlight),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.load(true));
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
    const days =
      silent && this.primed
        ? [...new Set([today, ...this.activeOrders.map((order) => order.createdAt.slice(0, 10))])]
        : recentDays(LOOKBACK_DAYS);
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
          if (!silent) this.loadError = succeeded === 0;
          if (this.demoPending) {
            this.demoPending = false;
            this.scheduleDemoOrder();
          }
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
    if (this.primed) this.announceNew(rows);
    for (const order of rows) this.knownIds.add(order.id);

    const incoming = rows.map((order) => {
      if (this.updatingId !== order.id) return order;
      const current = this.orders.find((item) => item.id === order.id);
      return current ? { ...order, status: current.status } : order;
    });
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

  primaryAction(order: DeliveryOrder): OrderStatus | null {
    switch (order.status) {
      case OrderStatus.Pending:
        return OrderStatus.Confirmed;
      case OrderStatus.Confirmed:
        return this.isDelivery(order) ? OrderStatus.Shipped : OrderStatus.ReadyForPickup;
      case OrderStatus.Shipped:
      case OrderStatus.ReadyForPickup:
        return OrderStatus.Delivered;
      default:
        return null;
    }
  }

  otherActions(order: DeliveryOrder): OrderStatus[] {
    const primary = this.primaryAction(order);
    return this.statuses.filter((status) => status !== order.status && status !== primary);
  }

  toggleMenu(order: DeliveryOrder, event: Event): void {
    event.stopPropagation();
    this.menuOpenId = this.menuOpenId === order.id ? null : order.id;
  }

  requestStatus(order: DeliveryOrder, status: number): void {
    this.menuOpenId = null;
    if (status === order.status || this.updatingId != null) return;
    if (status === OrderStatus.Canceled) {
      this.cancelPromptId = order.id;
      return;
    }
    this.applyStatus(order, status);
  }

  confirmCancel(order: DeliveryOrder): void {
    this.applyStatus(order, OrderStatus.Canceled);
  }

  dismissCancel(): void {
    this.cancelPromptId = null;
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
      { label: 'orders.building', value: order.buildingNumber },
      { label: 'orders.floor', value: order.floor },
      { label: 'orders.apartment', value: order.apartment },
    ]
      .map((part) => ({ label: this.translate.instant(part.label), value: (part.value || '').trim() }))
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

  mapHref(order: DeliveryOrder): string {
    const query = [
      order.street,
      order.buildingNumber,
      pickLocalized(this.lang, order.district, order.districtAr),
      pickLocalized(this.lang, order.city, order.cityAr),
      pickLocalized(this.lang, order.governorate, order.governorateAr),
    ]
      .map((part) => (part || '').trim())
      .filter(Boolean)
      .join(', ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  branchName(order: DeliveryOrder): string {
    return pickLocalized(this.lang, order.branchName, order.branchNameAr);
  }

  branchAddress(order: DeliveryOrder): string {
    return pickLocalized(this.lang, order.branchAddress, order.branchAddressAr);
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

  whatsAppHref(order: DeliveryOrder): string {
    return `https://wa.me/${dialPhone(order.phone).replace('+', '')}`;
  }

  trackById(_: number, order: DeliveryOrder): number {
    return order.id;
  }

  private applyStatus(order: DeliveryOrder, status: number): void {
    const previous = order.status;
    this.cancelPromptId = null;
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
        body: [
          order.fullName?.trim(),
          pickLocalized(this.lang, order.district, order.districtAr) ||
            pickLocalized(this.lang, order.city, order.cityAr),
          `${this.money(order.amountToCollect)} ${this.translate.instant('orders.currency')}`,
        ]
          .filter(Boolean)
          .join(' · '),
      }))
    );
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

function isOpen(status: number): boolean {
  return status !== OrderStatus.Delivered && status !== OrderStatus.Canceled;
}

function recentDays(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count + 1 }, (_, offset) =>
    toIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset))
  );
}

function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
