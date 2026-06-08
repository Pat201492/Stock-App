import { StockAppClient } from './client';

/**
 * Post the device's FCM token to the backend so the server can send
 * push notifications to this device. Call after a successful login.
 */
export async function registerFcmToken(
  client: StockAppClient,
  fcmToken: string,
): Promise<void> {
  await client.registerFcmToken(fcmToken);
}
