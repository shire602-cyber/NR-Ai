import { apiRequest } from './queryClient';

/**
 * Register the service worker for PWA + push notifications.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service worker registered:', registration.scope);
    return registration;
  } catch (error) {
    console.error('Service worker registration failed:', error);
    return null;
  }
}

/**
 * Request push notification permission and subscribe.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!('PushManager' in window)) {
    console.warn('Push notifications not supported');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('Push notification permission denied');
    return false;
  }

  try {
    // Get VAPID public key from server
    const { publicKey: vapidKey } = await apiRequest('GET', '/api/push/vapid-key');
    if (!vapidKey) {
      console.warn('VAPID key not configured on server');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as ArrayBuffer,
    });

    // Send subscription to server
    const subKeys = subscription.toJSON().keys;
    await apiRequest('POST', '/api/push/subscribe', {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subKeys?.p256dh,
        auth: subKeys?.auth,
      },
    });

    return true;
  } catch (error) {
    console.error('Push subscription failed:', error);
    return false;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();
      await apiRequest('DELETE', '/api/push/unsubscribe', {
        endpoint: subscription.endpoint,
      });
    }

    return true;
  } catch (error) {
    console.error('Push unsubscribe failed:', error);
    return false;
  }
}

/**
 * Check if push notifications are currently subscribed.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

// Convert VAPID key from base64 to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
