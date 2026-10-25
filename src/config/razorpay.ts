import crypto   from 'crypto';
import Razorpay from 'razorpay';
import { env }  from './env';

let client: Razorpay | null = null;

const notConfigured = () => {
  const err = new Error('Online payments are not configured') as any;
  err.code       = 'PAYMENT_GATEWAY_NOT_CONFIGURED';
  err.statusCode = 503;
  return err;
};

export const getRazorpay = (): Razorpay => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw notConfigured();
  if (!client) client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return client;
};

// Public key the app passes to Razorpay Checkout. Never send the secret.
export const getRazorpayKeyId = (): string => {
  if (!env.RAZORPAY_KEY_ID) throw notConfigured();
  return env.RAZORPAY_KEY_ID;
};

// Checkout signature = HMAC-SHA256(order_id + "|" + payment_id, key_secret).
export const isValidCheckoutSignature = (orderId: string, paymentId: string, signature: string): boolean => {
  if (!env.RAZORPAY_KEY_SECRET) throw notConfigured();
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// SDK errors look like { statusCode, error: { code, description } }.
// Bad keys are our misconfiguration, not the caller's, so they surface as
// a 5xx — a 401 here would make the app think its own login expired.
export const toGatewayError = (err: any) => {
  const description: string = err?.error?.description ?? err?.message ?? 'Payment gateway error';
  const authFailed = err?.statusCode === 401 || /authentication failed/i.test(description);
  const out = new Error(authFailed ? 'Payment gateway authentication failed' : description) as any;
  out.code       = authFailed ? 'PAYMENT_GATEWAY_AUTH_FAILED' : 'PAYMENT_GATEWAY_ERROR';
  out.statusCode = authFailed ? 500 : 502;
  return out;
};
