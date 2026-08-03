import { useCallback, useMemo } from 'react';

/**
 * Hook to access and manage rental session data stored during the booking process
 * @returns {Object} Object containing rental session data and utility functions
 */
export function useRentalSession() {
  const rentalData = useMemo(() => {
    const checkIn = sessionStorage.getItem('rentalCheckIn');
    const checkOut = sessionStorage.getItem('rentalCheckOut');
    const itemId = sessionStorage.getItem('rentalItemId');
    const rentalDays = Number(sessionStorage.getItem('rentalDays')) || 0;

    return {
      checkIn: checkIn ? new Date(checkIn) : null,
      checkOut: checkOut ? new Date(checkOut) : null,
      itemId: itemId || null,
      rentalDays,
      checkInFormatted: checkIn ? new Date(checkIn).toLocaleDateString('en-PH') : null,
      checkOutFormatted: checkOut ? new Date(checkOut).toLocaleDateString('en-PH') : null,
    };
  }, []);

  const clearRentalSession = useCallback(() => {
    sessionStorage.removeItem('rentalCheckIn');
    sessionStorage.removeItem('rentalCheckOut');
    sessionStorage.removeItem('rentalItemId');
    sessionStorage.removeItem('rentalDays');
  }, []);

  return {
    ...rentalData,
    clearRentalSession,
  };
}
