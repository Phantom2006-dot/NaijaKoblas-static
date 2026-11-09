import assert from "node:assert/strict";
import { createContactMessage, createNewsletterSubscription, listContactMessages, updateContactMessageStatus } from "./publicSubmissions";

const contact = await createContactMessage({
  firstName: "Ada",
  lastName: "Okafor",
  email: "ada@example.com",
  subject: "Order question",
  message: "Please help me understand the delivery status for my order.",
});
assert.equal(contact.stored, true);

const firstSubscription = await createNewsletterSubscription("ada@example.com", "newsletter");
const sameSubscription = await createNewsletterSubscription("ADA@example.com", "waitlist");
assert.equal(firstSubscription.id, sameSubscription.id, "subscription email must be deduplicated");

const listed = await listContactMessages({ search: "ada@example.com", status: "new" });
assert.equal(listed.total, 1);
assert.equal(listed.items[0]?.subject, "Order question");

const updated = await updateContactMessageStatus(contact.id, "in_progress");
assert.equal(updated.status, "in_progress");
const filtered = await listContactMessages({ status: "new" });
assert.equal(filtered.total, 0);

console.log("PASS public submissions: contact persistence, subscription dedupe, inbox search and status update");
