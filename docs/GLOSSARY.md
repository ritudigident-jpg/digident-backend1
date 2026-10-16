# Glossary

The business words used in the Digident apps, in plain English. When a word appears in code
(a status value, a field name) it is shown in `code`.

Apps: **OM** = Manual Order Console (OrderManagement), **CRM** = crmsystem,
**Store** = Digi-Ecom (online shop), **Site** = Digi-Front (public website).

## People

| Word | Meaning |
|---|---|
| Employee | Anyone who logs in to OM or the CRM. Has a role. |
| Role | What an employee may do. CRM roles are numbers in `constants/UserRoles.js` (`USER_ROLES`, labels in `ROLE_LABELS`). |
| Agent | Sales employee in the CRM. Sees only the leads and clients assigned to them. |
| Manager / Admin / Super Admin | Higher CRM roles. Can create clients directly; admins also assign leads and see Agent Performance. |
| Customer | Whoever an order or invoice is for. In OM, customers are grouped by phone number. |
| User | A shopper with an account on the Store. |

## CRM: from inquiry to client

A lead moves through `stage` values: `inquiry` -> `followup` -> `client`, or to `flag`.

| Word | Meaning |
|---|---|
| Lead | One person / clinic the sales team is working on. Every stage below is a lead. |
| Inquiry (`inquiry`) | A new lead, added by hand or by Excel import, waiting for calls. |
| Call round / touch | Agents call an inquiry in rounds of 3 calls ("touches"). After the 3rd call the next round starts. See `getRemarkProgress()`. |
| Remark | The note an agent writes after a call. |
| Follow-up (`followup`) | An interested lead the agent keeps calling until they buy. Also used for post-sale calls to a client. |
| Client (`client`) | A lead who has bought (or was created directly). Only clients can get CRM invoices. Listed in the **Client Book**. |
| Direct client | A client created by a manager / admin without going through inquiry and follow-up (`clientOrigin: "direct"`). |
| Flag (`flag`) | A lead an agent marked as wrong or unverifiable (bad number, fake details). Admins review flags. |
| Assign / distribute | Give unassigned leads to agents. `triggerDistribute()`. |
| Rebalance | Move leads nobody has touched yet from busy agents to free agents. `triggerRebalance()`. |
| Batch | Leads added by the same person within 3 minutes, shown as one group on the Admin page (usually one Excel import). |
| Agent Performance | Admin report per agent and period: new clients, products sold, invoices, money billed and received. |

## Orders (OM and Store)

| Word | Meaning |
|---|---|
| Manual order | An order an employee types into OM (phone or walk-in sale). |
| Ecommerce order | An order placed by a shopper on the Store. |
| Order stages | `placed` -> `packed` -> `confirmed` -> `shipped` -> `delivered` (or `cancelled`). |
| Cancel | Stop an order before delivery. |
| Return | The customer sends items back. Can be full or partial (some items / some quantity). |
| Refund | Money given back for a return or a cancelled paid order. |
| Coupon | A Store discount code. Types: `PERCENT` (with optional cap), `FIXED` (rupees), `BUY_X_GET_Y_FREE`. Rules in `utils/CouponRules.js`. |
| Razorpay | The Store's payment gateway. |

## Invoices and money

| Word | Meaning |
|---|---|
| Invoice | The tax invoice for a sale. |
| Order-linked invoice | Created by the backend for an order (has `sourceOrderId`). Returned items are removed and `paidAmount` is already net of refunds. |
| Standalone invoice | Created directly on the Invoices page (no order). A return does not change `paidAmount`; returned quantity is kept in `item.returnedQty`. |
| Invoice source | Where an invoice came from: Client, Manual order, Ecommerce, Old / Direct. Drives the tabs on the Invoices page. |
| Invoice status | `unpaid`, `partially_paid`, `paid`, `cancelled`. |
| Total | Invoice value before returns (`summary.totalPayAmount`). |
| Net payable | Total minus the value of returned goods. |
| Received / Paid | Money actually received for the invoice. |
| Balance due | Net payable minus what was received and kept. Never below 0. |
| Pending refund | Money the business still owes back to the customer (`refundableAmount`), not settled yet. |
| Settled back | Money already given back: cash payouts plus credit notes (`refundHistory`). |
| Settlement | Clearing a pending refund: pay it back (cash, UPI, bank) or turn it into credit on the next order / invoice. |
| Check credit | When creating an order or invoice, look up money this phone number is still owed and use it as a discount in the same step. |
| Applied credit | Credit from an earlier order / invoice used as payment on this one (`appliedCredits`, or `[Credit:<orderId>:<amount>]` tags in order notes). It is not cash, so it cannot be refunded again. |
| Credit note | A document that says the business owes the customer an amount. Made for a return or by hand (rate difference, discount after billing, short supply, goodwill). |
| Credit note status | `open` (nothing used), `partially_used`, `used`, `cancelled`. Usable while open / partly used and more than ₹0.01 is left. |
| Apply a credit note | Use its balance to pay one of the same customer's unpaid invoices. |
| Refund a credit note | Pay its balance back in cash / UPI / bank. |
| Statement | PDF of all invoices of one customer with billed, paid and due totals. |
| Ledger | A customer's running picture of invoices, payments, returns and credit. OM: Customer Ledger page. |
| GST / GSTIN | Indian goods and services tax / the tax number of a business. Shown on invoices. |
| HSN code | Product tax classification code printed on each invoice line. |
| Paise rounding | Money is rounded to 2 decimals (paise), half up: `round2()`, `roundToPaise()`. |

## Website (Site)

| Word | Meaning |
|---|---|
| Library | CAD library files per implant brand, downloadable after email verification. |
| Career / Job application | Open jobs and the application form (with resume upload). |
| Testimonial | A customer quote shown on the home page and /testimonials. |
| Product pages | ScanBody, ScanBridge, Abutment, Screw, LabAnalog: the dental implant parts Digident sells. |
