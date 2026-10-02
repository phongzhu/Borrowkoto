import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getUserUnsettledDues } from '../services/accountDuesService';
import DataLoadingScreen from '../ui/DataLoadingScreen';
import { Button, Modal, StatusMessage } from '../ui/primitives';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

function AuthLoadingScreen() {
  return (
    <div style={{ margin: '0 auto', maxWidth: 760, padding: '16px 20px' }}>
      <DataLoadingScreen label="Checking your session" message="Connecting to your account securely." title="Getting your account ready" />
    </div>
  );
}

export default function ProtectedRoute({ adminOnly = false }) {
  const { loading, role, studentAccess, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [accountDues, setAccountDues] = useState(null);

  useEffect(() => {
    let active = true;

    if (loading || !user?.id || role === 'admin' || adminOnly) {
      setAccountDues(null);
      return () => {
        active = false;
      };
    }

    getUserUnsettledDues(user.id)
      .then((summary) => {
        if (active) setAccountDues(summary);
      })
      .catch((error) => {
        console.error('Unable to load account dues notice:', error);
        if (active) setAccountDues(null);
      });

    return () => {
      active = false;
    };
  }, [adminOnly, loading, location.key, role, user?.id]);

  if (loading) return <AuthLoadingScreen />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (role === 'admin') {
    return <Outlet />;
  }

  if (adminOnly) {
    return <Navigate to="/user/dashboard" replace />;
  }

  if (!studentAccess) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ authError: 'This account is not linked to an active NU Baliwag student registry record.', from: location }}
      />
    );
  }

  const isDuesSettlementPage = location.pathname === '/user/manage-booking' || location.pathname === '/user/bookings';
  const showDuesModal = Boolean(accountDues?.hasDues && !isDuesSettlementPage);

  return (
    <>
      <Outlet />
      <Modal
        actions={(
          <Button onClick={() => navigate('/user/manage-booking?tab=dues')} type="button">
            Review and pay dues
          </Button>
        )}
        onClose={() => {}}
        open={showDuesModal}
        size="compact"
        title="Account temporarily frozen"
      >
        <div style={{ display: 'grid', gap: 14, maxWidth: 620 }}>
          <StatusMessage tone="warning">
            Settle your outstanding late fee or approved damage charge before borrowing another item.
          </StatusMessage>
          <div style={{ display: 'grid', gap: 6 }}>
            {accountDues?.lateFeeCount > 0 ? (
              <>
                <span>
                  Accrued late fee: <strong>{currencyFormatter.format(accountDues.lateFeeGrossTotal)}</strong>
                </span>
                <span>
                  Security deposit applied first: <strong>-{currencyFormatter.format(accountDues.depositAppliedTotal)}</strong>
                </span>
                <span>
                  Remaining late-fee balance: <strong>{currencyFormatter.format(accountDues.lateFeeTotal)}</strong>
                </span>
              </>
            ) : null}
            {accountDues?.damageCount > 0 ? (
              <span>
                Damage charge balance: <strong>{currencyFormatter.format(accountDues.damageTotal)}</strong>
              </span>
            ) : null}
            {accountDues?.totalDue > 0 ? (
              <span>
                Total amount due: <strong>{currencyFormatter.format(accountDues.totalDue)}</strong>
              </span>
            ) : null}
          </div>
          <span>
            For a late return, PayMongo payment submits the item for return. The owner must still confirm the physical return before the booking is completed.
          </span>
        </div>
      </Modal>
    </>
  );
}
