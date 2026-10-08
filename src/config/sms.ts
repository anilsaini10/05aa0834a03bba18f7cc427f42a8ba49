import { env } from './env';

// ── SMS provider abstraction ──────────────────────────────────
// Callers only use sendSms(); which provider actually delivers the
// message is picked from SMS_PROVIDER. To plug in a real gateway
// (MSG91 / Fast2SMS / Twilio …), add a provider object below, add its
// name to SMS_PROVIDER in env.ts, and register it in `providers`.
export interface SmsProvider {
  name: string;
  send: (to: string, message: string) => Promise<void>;
}

// Local/dev provider — prints the SMS to the server console instead of
// sending it, so OTP flows can be tested without any SMS cost.
const consoleProvider: SmsProvider = {
  name: 'console',
  send: async (to, message) => {
    console.log('\n📱 ─── SMS (console provider) ───────────────────');
    console.log(`   To:      ${to}`);
    console.log(`   Message: ${message}`);
    console.log('─────────────────────────────────────────────────\n');
  },
};

const providers: Record<typeof env.SMS_PROVIDER, SmsProvider> = {
  console: consoleProvider,
};

let provider: SmsProvider | null = null;

export const initSms = (): void => {
  if (provider) return;

  provider = providers[env.SMS_PROVIDER];

  if (provider.name === 'console' && env.NODE_ENV === 'production') {
    console.warn('⚠️  SMS_PROVIDER=console in production — OTPs will only be printed to the server log');
  }

  console.log(`✅ SMS provider initialized (${provider.name})`);
};

export const sendSms = async (to: string, message: string): Promise<void> => {
  if (!provider) initSms();
  await provider!.send(to, message);
};
