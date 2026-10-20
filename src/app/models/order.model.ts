export enum OrderStatus {
  Pending = 0,
  Confirmed = 1,
  Shipped = 2,
  Delivered = 3,
  Canceled = 4,
  ReadyForPickup = 5,
}

export interface OrderItem {
  productId: number;
  productName: string;
  productNameAr: string;
  quantity: number;
  variantName: string | null;
  variantNameAr: string | null;
}

export interface DeliveryOrder {
  id: number;
  code: string;
  createdAt: string;
  status: number;
  fullName: string;
  phone: string;
  governorate: string;
  governorateAr: string;
  city: string;
  cityAr: string;
  district: string;
  districtAr: string;
  street: string;
  buildingNumber: string;
  floor: string;
  apartment: string;
  landmark: string;
  branchId: number;
  branchName: string;
  branchNameAr: string;
  branchAddress: string | null;
  branchAddressAr: string | null;
  branchPhone: string | null;
  totalAmount: number;
  deliveryFee: number;
  paymentMethod: string;
  paymentStatus: number;
  amountToCollect: number;
  items: OrderItem[];
}

export interface DriverProfile {
  fullName: string;
  phoneNumber: string;
}
