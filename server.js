import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-01";
const ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const PORT = Number(process.env.PORT || 3001);

const DATA_DIR = path.resolve("./data");
const NOTIFICATIONS_FILE = path.join(DATA_DIR, "notifications.json");
const PREFERENCES_FILE = path.join(DATA_DIR, "notification-preferences.json");

function ensureEnv() {
  if (!SHOPIFY_STORE) throw new Error("Missing SHOPIFY_STORE in .env");
  if (!ADMIN_ACCESS_TOKEN) {
    throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN in .env");
  }
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(NOTIFICATIONS_FILE)) {
    fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify({}, null, 2), "utf8");
  }

  if (!fs.existsSync(PREFERENCES_FILE)) {
    fs.writeFileSync(PREFERENCES_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getDefaultPreferences(email = "") {
  return {
    email,
    expoPushToken: "",
    pushEnabled: true,
    promoEnabled: true,
    orderEnabled: true,
    stockEnabled: true,
    priceEnabled: true,
    updatedAt: new Date().toISOString()
  };
}

function getSeedNotifications(email) {
  const now = new Date();
  return [
    {
      id: `${email}-1`,
      type: "promo",
      title: "Special deals are live",
      message: "Check today’s top offers and limited-time discounts on WeBuyOne.",
      time: "Just now",
      unread: true,
      createdAt: now.toISOString()
    },
    {
      id: `${email}-2`,
      type: "order",
      title: "Order updates will appear here",
      message: "When you place an order, shipping and delivery updates will be shown here.",
      time: "Today",
      unread: false,
      createdAt: now.toISOString()
    },
    {
      id: `${email}-3`,
      type: "stock",
      title: "Back in stock alerts",
      message: "Products you follow can appear here when inventory is available again.",
      time: "Today",
      unread: false,
      createdAt: now.toISOString()
    }
  ];
}

async function shopifyAdminRequest(query, variables = {}) {
  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/${ADMIN_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const raw = await res.text();
  let json = null;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid Shopify response (${res.status})`);
  }

  if (!res.ok) {
    throw new Error(
      json?.errors?.[0]?.message || json?.message || `HTTP ${res.status}`
    );
  }

  if (json?.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("\n"));
  }

  return json.data;
}

async function findCustomerByEmail(email) {
  const query = `
    query getCustomers($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            email
            firstName
            lastName
            canDelete
            numberOfOrders
          }
        }
      }
    }
  `;

  const data = await shopifyAdminRequest(query, {
    query: `email:${email}`
  });

  return data?.customers?.edges?.[0]?.node || null;
}

async function deleteCustomer(customerId) {
  const mutation = `
    mutation customerDelete($input: CustomerDeleteInput!) {
      customerDelete(input: $input) {
        deletedCustomerId
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyAdminRequest(mutation, {
    input: { id: customerId }
  });

  const payload = data?.customerDelete;

  if (payload?.userErrors?.length) {
    throw new Error(payload.userErrors.map((e) => e.message).join("\n"));
  }

  return payload;
}

async function requestCustomerDataErasure(customerId) {
  const mutation = `
    mutation customerRequestDataErasure($customerId: ID!) {
      customerRequestDataErasure(customerId: $customerId) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyAdminRequest(mutation, {
    customerId
  });

  const payload = data?.customerRequestDataErasure;

  if (payload?.userErrors?.length) {
    throw new Error(payload.userErrors.map((e) => e.message).join("\n"));
  }

  return payload;
}

app.get("/", (_req, res) => {
  res.status(200).send("WeBuyOne backend is live.");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "webuyone-delete-backend" });
});

app.get("/account/delete", (_req, res) => {
  res.status(200).send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>WeBuyOne - Account Deletion</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f6f6f6;
            color: #111;
          }
          .wrap {
            max-width: 760px;
            margin: 0 auto;
            padding: 40px 20px;
          }
          .card {
            background: #fff;
            border-radius: 20px;
            padding: 28px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
          }
          h1 {
            margin: 0 0 12px;
            font-size: 28px;
            line-height: 1.2;
          }
          p {
            margin: 0 0 14px;
            font-size: 16px;
            line-height: 1.7;
            color: #444;
          }
          ol {
            margin: 12px 0 18px;
            padding-left: 22px;
            color: #444;
            line-height: 1.8;
          }
          .note {
            margin-top: 18px;
            padding: 14px 16px;
            border-radius: 12px;
            background: #fff4f4;
            color: #8e1f1f;
            font-size: 15px;
            line-height: 1.7;
          }
          .box {
            margin-top: 18px;
            padding: 14px 16px;
            border-radius: 12px;
            background: #f3f4f6;
            color: #222;
            font-size: 14px;
            line-height: 1.7;
            word-break: break-word;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <h1>Delete Your WeBuyOne Account</h1>
            <p>WeBuyOne allows users to initiate account deletion directly inside the mobile app.</p>
            <p>To request deletion of your account, open the app and go to:</p>
            <ol>
              <li>Account</li>
              <li>Settings</li>
              <li>Delete Account</li>
              <li>Confirm deletion</li>
            </ol>
            <div class="note">
              If the account has no order history, it may be deleted immediately.
              If the account has order history, a customer data erasure request is submitted for processing.
            </div>
            <div class="box">Backend endpoint used by the app: POST /account/delete</div>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.post("/account/delete", async (req, res) => {
  try {
    ensureEnv();

    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "Email is required."
      });
    }

    const customer = await findCustomerByEmail(email);

    if (!customer) {
      return res.status(404).json({
        ok: false,
        message: "Customer not found."
      });
    }

    if (customer.canDelete) {
      const result = await deleteCustomer(customer.id);

      return res.json({
        ok: true,
        status: "deleted",
        deletedCustomerId: result?.deletedCustomerId || null,
        message: "Customer account deleted successfully."
      });
    }

    await requestCustomerDataErasure(customer.id);

    return res.status(202).json({
      ok: true,
      status: "erasure_requested",
      code: "DATA_ERASURE_REQUESTED",
      message:
        "This account has order history. A customer data erasure request has been submitted."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error?.message || "Server error."
    });
  }
});

app.get("/notifications", (req, res) => {
  try {
    const email = normalizeEmail(req.query?.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Email is required."
      });
    }

    const db = readJsonFile(NOTIFICATIONS_FILE);

    if (!Array.isArray(db[email])) {
      db[email] = getSeedNotifications(email);
      writeJsonFile(NOTIFICATIONS_FILE, db);
    }

    return res.json({
      ok: true,
      notifications: db[email]
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Unable to load notifications."
    });
  }
});

app.post("/notifications/mark-all-read", (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Email is required."
      });
    }

    const db = readJsonFile(NOTIFICATIONS_FILE);
    const current = Array.isArray(db[email]) ? db[email] : [];

    db[email] = current.map((item) => ({
      ...item,
      unread: false
    }));

    writeJsonFile(NOTIFICATIONS_FILE, db);

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Unable to mark notifications as read."
    });
  }
});

app.post("/notifications/preferences", (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Email is required."
      });
    }

    const prefsDb = readJsonFile(PREFERENCES_FILE);
    const existing = prefsDb[email] || getDefaultPreferences(email);

    prefsDb[email] = {
      ...existing,
      email,
      expoPushToken: String(req.body?.expoPushToken || existing.expoPushToken || ""),
      pushEnabled: Boolean(req.body?.pushEnabled),
      promoEnabled: Boolean(req.body?.promoEnabled),
      orderEnabled: Boolean(req.body?.orderEnabled),
      stockEnabled: Boolean(req.body?.stockEnabled),
      priceEnabled: Boolean(req.body?.priceEnabled),
      updatedAt: new Date().toISOString()
    };

    writeJsonFile(PREFERENCES_FILE, prefsDb);

    return res.json({
      ok: true,
      preferences: prefsDb[email]
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Unable to save notification preferences."
    });
  }
});

app.get("/notifications/preferences", (req, res) => {
  try {
    const email = normalizeEmail(req.query?.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Email is required."
      });
    }

    const prefsDb = readJsonFile(PREFERENCES_FILE);
    const prefs = prefsDb[email] || getDefaultPreferences(email);

    return res.json({
      ok: true,
      preferences: prefs
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Unable to load notification preferences."
    });
  }
});

app.post("/notifications/send-test", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Email is required."
      });
    }

    const prefsDb = readJsonFile(PREFERENCES_FILE);
    const prefs = prefsDb[email];

    if (!prefs?.expoPushToken) {
      return res.status(400).json({
        ok: false,
        error: "No Expo push token found for this email."
      });
    }

    if (!prefs.pushEnabled) {
      return res.status(400).json({
        ok: false,
        error: "Push notifications are disabled for this user."
      });
    }

    const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: prefs.expoPushToken,
        sound: "default",
        title: "WeBuyOne",
        body: "This is a test push notification.",
        data: {
          type: "test"
        }
      })
    });

    const expoJson = await expoRes.json();

    return res.json({
      ok: true,
      expo: expoJson
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Unable to send test push notification."
    });
  }
});

ensureDataFiles();
ensureEnv();

app.listen(PORT, () => {
  console.log(`Delete account backend running on http://localhost:${PORT}`);
});