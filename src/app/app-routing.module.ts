import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthLayoutComponent } from './Components/Layouts/auth-layout/auth-layout.component';
import { MainLayoutComponent } from './Components/Layouts/main-layout/main-layout.component';
import { LoginComponent } from './Components/login/login.component';
import { OrdersComponent } from './Components/orders/orders.component';
import { authGuard, guestGuard } from './guards/auth.guard';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'orders' },
  {
    path: 'auth',
    component: AuthLayoutComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'login' },
      { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
    ],
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [{ path: 'orders', component: OrdersComponent }],
  },
  { path: '**', redirectTo: 'orders' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
