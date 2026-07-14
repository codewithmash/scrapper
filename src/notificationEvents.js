/**
 * Shared notification event tracking for the admin dashboard.
 * Both the scheduler (notify.js) and admin routes can record events here.
 */

const events = [];
const MAX_EVENTS = 200;

export function addNotificationEvent(event) {
  events.unshift({
    ...event,
    timestamp: event.timestamp || new Date().toISOString()
  });
  if (events.length > MAX_EVENTS) {
    events.length = MAX_EVENTS;
  }
}

export function getNotificationEvents() {
  return events;
}
