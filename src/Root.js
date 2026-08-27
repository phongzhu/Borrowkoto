import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import { UISettingsProvider } from './context/UISettingsContext';
import UserLoginPage from './pages/user/UserLoginPage';
import UserDashboard from './pages/user/UserDashboard';
import MyBookings from './pages/user/MyBookings';
import ListingFAQs from './pages/user/ListingFAQs';
import Messages from './pages/user/Messages';
import Profile from './pages/user/Profile';
import RentItem from './pages/user/rent-item';
import ViewItemList from './pages/user/view-item-list';
import PublicItemsCatalogPage from './pages/user/PublicItemsCatalogPage';
import ListItemLanding from './pages/user/ListItemLanding';
import UserRentalsCalendar from './pages/user/UserRentalsCalendar';
import RentalIncome from './pages/user/RentalIncome';
import SavedListings from './pages/user/SavedListings';
import Rewards from './pages/user/Rewards';
import Promotions from './pages/user/Promotions';
import AdminDashboard from './pages/admin/AdminDashboard';
import ManageCatalog from './pages/admin/ManageCatalog';
import AdminProfile from './pages/admin/AdminProfile';
import ManageUsers from './pages/admin/ManageUsers';
import ManageReports from './pages/admin/ManageReports';
import UISettings from './pages/admin/UISettings';
import PromotionSettings from './pages/admin/PromotionSettings';
import VoucherRewards from './pages/admin/VoucherRewards';
import TransactionsTesting from './services/transactions_testing';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';

export default function Root() {
  return (
    <UISettingsProvider>
      <AuthProvider>
        <Router>
          <Routes>
          <Route path="/" element={<App />} />
          <Route path="/home" element={<App />} />
          <Route path="/items" element={<PublicItemsCatalogPage />} />
          <Route path="/items/:itemId" element={<ViewItemList publicMode />} />
          <Route path="/list-item" element={<ListItemLanding />} />
          <Route path="/login" element={<UserLoginPage />} />
          <Route path="/signup" element={<Navigate to="/login" replace />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/user/dashboard" element={<UserDashboard />} />
            <Route path="/user/browse-listings" element={<Navigate to="/" replace />} />
            <Route path="/user/saved-listings" element={<SavedListings />} />
            <Route path="/user/rewards" element={<Rewards />} />
            <Route path="/user/promotions" element={<Promotions />} />
            <Route path="/user/view-item-list/:itemId" element={<ViewItemList />} />
            <Route path="/user/rent-item/:itemId" element={<RentItem />} />
            <Route path="/user/rental-items" element={<MyBookings viewMode="rental-items" />} />
            <Route path="/user/rental-items/add" element={<MyBookings viewMode="rental-items" listingMode="add" />} />
            <Route path="/user/rental-items/edit/:itemId" element={<MyBookings viewMode="rental-items" />} />
            <Route path="/user/manage-booking" element={<MyBookings viewMode="manage-booking" />} />
            <Route path="/user/schedule-booking" element={<Navigate to="/user/manage-booking?tab=schedule" replace />} />
            <Route path="/user/rental-income" element={<RentalIncome />} />
            <Route path="/user/bookings" element={<MyBookings viewMode="manage-booking" />} />
            <Route path="/user/calendar" element={<UserRentalsCalendar />} />
            <Route path="/user/messages" element={<Messages />} />
            <Route path="/user/listing-faqs" element={<ListingFAQs />} />
            <Route path="/user/profile" element={<Profile />} />
            <Route path="/user/profile/verification" element={<Navigate to="/user/profile" replace />} />
          </Route>
          <Route path="/admin/login" element={<Navigate to="/login" replace />} />
          <Route element={<ProtectedRoute adminOnly />}>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/profile" element={<AdminProfile />} />
            <Route path="/admin/users" element={<ManageUsers />} />
            <Route path="/admin/catalog" element={<ManageCatalog />} />
            <Route path="/admin/reports" element={<ManageReports />} />
            <Route path="/admin/ui-settings" element={<UISettings />} />
            <Route path="/admin/promotion-settings" element={<PromotionSettings />} />
            <Route path="/admin/voucher-rewards" element={<VoucherRewards />} />
            <Route path="/services/transactions-testing" element={<TransactionsTesting />} />
          </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </UISettingsProvider>
  );
}
