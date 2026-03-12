import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-01";
const ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const PORT = Number(process.env.PORT || 3001);

function ensureEnv() {
  if (!SHOPIFY_STORE) throw new Error("Missing SHOPIFY_STORE in .env");
  if (!ADMIN_ACCESS_TOKEN) {
    throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN in .env");
  }
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

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "webuyone-delete-backend" });
});

app.post("/account/delete", async (req, res) => {
  try {
    ensureEnv();

    const email = String(req.body?.email || "").trim().toLowerCase();

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

app.listen(PORT, () => {
  console.log(`Delete account backend running on http://localhost:${PORT}`);
});
