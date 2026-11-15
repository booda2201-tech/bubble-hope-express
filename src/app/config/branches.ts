import { DeliveryOrder } from '../models/order.model';

export interface BranchLocation {
  lat: number;
  lng: number;
  /** The branch's own Google Maps link (place page). */
  mapUrl: string;
  addressAr?: string;
  address?: string;
  /** Matched against the branch name the API sends, in either language. */
  match: RegExp;
}

/**
 * Exact branch pins taken from the cafe's Google Maps places. The API doesn't send branch
 * locations yet, and searching by branch name lands in the wrong place.
 * Order matters: the first match wins, so the more specific names come first.
 */
export const BRANCH_LOCATIONS: BranchLocation[] = [
  {
    lat: 29.9996108,
    lng: 31.099236,
    mapUrl: 'https://maps.app.goo.gl/quj9MXEbJp6EnG7X7',
    addressAr: 'محطة فيول أب، الطريق الدائري - طريق الواحات',
    address: 'Fuel Up station, Ring Road - Wahat Road',
    match: /فيول|fuel|الواحات|واحات|wahat|wahaat|الدائري|دائري|ring/i,
  },
  {
    lat: 29.93367,
    lng: 31.0442767,
    mapUrl: 'https://maps.app.goo.gl/7sSupihYcc18gKJN8',
    match: /زويل|zewail|zuwail|zwail/i,
  },
  {
    lat: 29.9808127,
    lng: 31.1024875,
    mapUrl: 'https://maps.app.goo.gl/7F8qhMaCPmBMy8by7',
    match: /حدائق|حدايق|hadayek|hadaek|hadaiq|ahram/i,
  },
];

export function branchLocation(order: Pick<DeliveryOrder, 'branchName' | 'branchNameAr'>): BranchLocation | null {
  const names = `${order.branchNameAr || ''} ${order.branchName || ''}`;
  return BRANCH_LOCATIONS.find((branch) => branch.match.test(names)) ?? null;
}
