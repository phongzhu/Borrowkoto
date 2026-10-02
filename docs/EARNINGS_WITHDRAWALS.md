# Earnings withdrawals

Owners can request a withdrawal of eligible earnings from **Withdraw earnings**. Each request immediately invokes the `earnings-payout` Edge Function and starts a PayMongo test transfer. A pending transfer reserves the balance until PayMongo reports a final status. The admin screen at `/admin/withdrawals` shows platform-fee income and transfer history.

## Deploy the database and function

Apply the `20261002130000_add_earnings_withdrawals.sql` migration, then deploy the `earnings-payout` Supabase Edge Function.

Configure the function with a PayMongo **test secret key** and test wallet source account:

```sh
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_... PAYMONGO_TEST_SOURCE_ACCOUNT_NUMBER=... PAYMONGO_TEST_SOURCE_ACCOUNT_NAME="Borrow Ko To Test"
```

Use the source account number and account name shown for the activated **test-mode PayMongo wallet**. These are merchant wallet details, not the recipient's GCash details. Missing wallet configuration leaves a withdrawal request pending so it can be retried after configuration is fixed; it does not mark the request as a payout failure.

The function refuses live keys. Withdrawals use the PayMongo Transfers v2 InstaPay endpoint and are limited to PHP 50,000 each. In test mode, the function defaults to PayMongo's deterministic success destination `999999990001`; set `PAYMONGO_TEST_DESTINATION_ACCOUNT_NUMBER` to another PayMongo test destination to simulate failure cases. The user's submitted GCash number stays in the app's withdrawal record and is not sent as a live payout destination. No real money is moved.

## Balance rules

Only eligible settled earnings are withdrawable. Pending and processing requests reserve funds; paid requests reduce the balance permanently; failed or rejected requests release the reservation.
