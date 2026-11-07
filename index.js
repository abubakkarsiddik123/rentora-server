const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 5005;

const client = new MongoClient(process.env.MONGODB_URI);
const CLIENT_URL = process.env.CLIENT_URL;

if (!process.env.MONGODB_URI || !CLIENT_URL) {
  throw new Error("MONGODB_URI and CLIENT_URL must be set in .env");
}

app.use(
  cors({
    origin: CLIENT_URL,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Rentora server running");
});

// JWT Middleware
let jwtVerify;
let JWKS;

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).send({
        error: true,
        message: "Unauthorized access. Bearer token required.",
      });
    }

    const token = authHeader.slice(7);

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: CLIENT_URL,
      audience: CLIENT_URL,
    });

    if (!payload.sub || !["tenant", "owner", "admin"].includes(payload.role)) {
      return res.status(401).send({
        error: true,
        message: "Invalid user token.",
      });
    }

    req.user = {
      id: payload.sub,
      name: payload.name || "",
      email: payload.email || "",
      role: payload.role,
    };

    next();
  } catch (error) {
    return res.status(401).send({
      error: true,
      message: "Invalid or expired token.",
    });
  }
};

// Role Middleware
const verifyRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).send({
        error: true,
        message: "Forbidden access.",
      });
    }

    next();
  };
};

const asyncHandler = (handler) => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

const isValidId = (id) => ObjectId.isValid(id);

let propertyCollection;
let bookingCollection;
let transactionCollection;
let favoriteCollection;
let userCollection;

// ==========================================
// PROPERTY APIs
// ==========================================



// Get all approved properties
app.get(
  "/api/properties",
  asyncHandler(async (req, res) => {
    const { search, location, type, minPrice, maxPrice, bedrooms, sort } =
      req.query;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 9, 1), 50);

    const skip = (page - 1) * limit;

    const query = { status: "approved" };

    if (type) query.type = type;

    if (location) {
      query.location = {
        $regex: location,
        $options: "i",
      };
    }

    if (bedrooms) {
      query.bedrooms = { $gte: Number(bedrooms) };
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];
    }

    if (minPrice || maxPrice) {
      query.price = {};

      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    const sortMap = {
      newest: { createdAt: -1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
    };

    const items = await propertyCollection
      .find(query)
      .sort(sortMap[sort] || sortMap.newest)
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await propertyCollection.countDocuments(query);

    res.send({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

// Get owner's properties
app.get(
  "/api/my/properties",
  verifyToken,
  verifyRole("owner", "admin"),
  asyncHandler(async (req, res) => {
    const query = {};

    if (req.user.role === "owner") {
      query.ownerId = req.user.id;
    } else if (req.query.ownerId) {
      query.ownerId = req.query.ownerId;
    }

    if (req.query.status) {
      query.status = req.query.status;
    }

    const result = await propertyCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);
  }),
);

// Get featured properties
app.get(
  "/api/properties/featured",
  asyncHandler(async (req, res) => {
    const result = await propertyCollection
      .find({
        status: "approved",
        featured: true,
      })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.send(result);
  }),
);

// Get single property
app.get(
  "/api/properties/:id",
  asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).send({
        error: true,
        message: "Invalid property id.",
      });
    }

    const result = await propertyCollection.findOne({
      _id: new ObjectId(req.params.id),
      status: { $in: ["approved", "booked"] },
    });

    if (!result) {
      return res.status(404).send({
        error: true,
        message: "Property not found.",
      });
    }

    res.send(result);
  }),
);

// Create property - Owner only
app.post(
  "/api/properties",
  verifyToken,
  verifyRole("owner"),
  asyncHandler(async (req, res) => {
    const propertyData = { ...req.body };

    [
      "_id",
      "ownerId",
      "ownerEmail",
      "ownerName",
      "status",
      "rejectionReason",
      "featured",
      "createdAt",
      "updatedAt",
    ].forEach((field) => delete propertyData[field]);

    const newProperty = {
      ...propertyData,
      ownerId: req.user.id,
      ownerName: req.user.name,
      ownerEmail: req.user.email,
      status: "pending",
      rejectionReason: "",
      featured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await propertyCollection.insertOne(newProperty);

    res.status(201).send({
      acknowledged: result.acknowledged,
      insertedId: result.insertedId,
    });
  }),
);

// Update property - Owner only
app.patch(
  "/api/properties/:id",
  verifyToken,
  verifyRole("owner"),
  asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).send({
        error: true,
        message: "Invalid property id.",
      });
    }

    const fields = { ...req.body };

    [
      "_id",
      "ownerId",
      "ownerEmail",
      "ownerName",
      "createdAt",
      "featured",
      "status",
      "rejectionReason",
    ].forEach((field) => delete fields[field]);

    const result = await propertyCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
        ownerId: req.user.id,
      },
      {
        $set: {
          ...fields,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        error: true,
        message: "Property not found or you are not the owner.",
      });
    }

    res.send(result);
  }),
);

// Approve / Reject property - Admin only
app.patch(
  "/api/properties/:id/status",
  verifyToken,
  verifyRole("admin"),
  asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).send({
        error: true,
        message: "Invalid property id.",
      });
    }

    const { status, rejectionReason } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).send({
        error: true,
        message: "Status must be approved or rejected.",
      });
    }

    if (status === "rejected" && !rejectionReason?.trim()) {
      return res.status(400).send({
        error: true,
        message: "Rejection reason is required.",
      });
    }

    const result = await propertyCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          status,
          rejectionReason: status === "rejected" ? rejectionReason.trim() : "",
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        error: true,
        message: "Property not found.",
      });
    }

    res.send(result);
  }),
);

// Delete property - Owner only
app.delete(
  "/api/properties/:id",
  verifyToken,
  verifyRole("owner"),
  asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).send({
        error: true,
        message: "Invalid property id.",
      });
    }

    const result = await propertyCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      ownerId: req.user.id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        error: true,
        message: "Property not found or you are not the owner.",
      });
    }

    res.send(result);
  }),
);
// ==========================================
// BOOKING APIs
// ==========================================

// Get bookings
app.get(
  "/api/bookings",
  verifyToken,
  verifyRole("tenant", "owner", "admin"),
  asyncHandler(async (req, res) => {
    const query = {};

    if (req.user.role === "tenant") {
      query.tenantId = req.user.id;
    }

    if (req.user.role === "owner") {
      query.ownerId = req.user.id;
    }

    if (req.user.role === "admin") {
      if (req.query.tenantId) {
        query.tenantId = req.query.tenantId;
      }

      if (req.query.ownerId) {
        query.ownerId = req.query.ownerId;
      }
    }

    if (req.query.propertyId) {
      query.propertyId = req.query.propertyId;
    }

    if (req.query.status) {
      query.status = req.query.status;
    }

    const result = await bookingCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);
  }),
);

// Get single booking
app.get(
  "/api/bookings/:id",
  verifyToken,
  asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).send({
        error: true,
        message: "Invalid booking id.",
      });
    }

    const query = {
      _id: new ObjectId(req.params.id),
    };

    if (req.user.role === "tenant") {
      query.tenantId = req.user.id;
    }

    if (req.user.role === "owner") {
      query.ownerId = req.user.id;
    }

    const result = await bookingCollection.findOne(query);

    if (!result) {
      return res.status(404).send({
        error: true,
        message: "Booking not found.",
      });
    }

    res.send(result);
  }),
);

// Create booking - Tenant only
app.post(
  "/api/bookings",
  verifyToken,
  verifyRole("tenant"),
  asyncHandler(async (req, res) => {
    const { propertyId, moveInDate, phone, notes } = req.body;

    if (!isValidId(propertyId) || !moveInDate || !phone) {
      return res.status(400).send({
        error: true,
        message: "propertyId, moveInDate and phone are required.",
      });
    }

    const property = await propertyCollection.findOne({
      _id: new ObjectId(propertyId),
      status: "approved",
    });

    if (!property) {
      return res.status(404).send({
        error: true,
        message: "Property not found or not available.",
      });
    }

    if (property.ownerId === req.user.id) {
      return res.status(400).send({
        error: true,
        message: "You cannot book your own property.",
      });
    }

    const existing = await bookingCollection.findOne({
      propertyId,
      tenantId: req.user.id,
      status: {
        $in: ["pending", "approved"],
      },
    });

    if (existing) {
      if (existing.paymentStatus === "unpaid") {
        return res.send({
          insertedId: existing._id,
          existing: true,
        });
      }

      return res.status(409).send({
        error: true,
        message: "You already booked this property.",
      });
    }

    const newBooking = {
      propertyId,
      propertyTitle: property.title,
      propertyImage: property.images?.[0] || "",

      ownerId: property.ownerId,
      ownerName: property.ownerName,
      ownerEmail: property.ownerEmail,

      tenantId: req.user.id,
      tenantName: req.user.name,
      tenantEmail: req.user.email,

      moveInDate,
      phone,
      notes: notes || "",

      amount: Math.round(Number(property.price) * 0.1),

      status: "pending",
      paymentStatus: "unpaid",
      createdAt: new Date(),
    };

    const result = await bookingCollection.insertOne(newBooking);

    res.status(201).send({
      acknowledged: result.acknowledged,
      insertedId: result.insertedId,
    });
  }),
);

// Approve / Reject booking - Owner only
app.patch(
  "/api/bookings/:id/status",
  verifyToken,
  verifyRole("owner"),
  asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).send({
        error: true,
        message: "Invalid booking id.",
      });
    }

    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).send({
        error: true,
        message: "Status must be approved or rejected.",
      });
    }

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(req.params.id),
      ownerId: req.user.id,
    });

    if (!booking) {
      return res.status(404).send({
        error: true,
        message: "Booking not found or you are not the owner.",
      });
    }

    if (booking.status !== "pending") {
      return res.status(400).send({
        error: true,
        message: `This booking is already ${booking.status}.`,
      });
    }

    if (status === "approved") {
      if (booking.paymentStatus !== "paid") {
        return res.status(400).send({
          error: true,
          message: "Tenant has not paid yet. You cannot approve this booking.",
        });
      }

      const propertyResult = await propertyCollection.updateOne(
        {
          _id: new ObjectId(booking.propertyId),
          ownerId: req.user.id,
          status: "approved",
        },
        {
          $set: {
            status: "booked",
            updatedAt: new Date(),
          },
        },
      );

      if (propertyResult.matchedCount === 0) {
        return res.status(409).send({
          error: true,
          message: "This property is no longer available.",
        });
      }

      await bookingCollection.updateMany(
        {
          propertyId: booking.propertyId,
          _id: { $ne: booking._id },
          status: "pending",
        },
        {
          $set: {
            status: "rejected",
            respondedAt: new Date(),
          },
        },
      );
    }

    const result = await bookingCollection.updateOne(
      {
        _id: booking._id,
        ownerId: req.user.id,
        status: "pending",
      },
      {
        $set: {
          status,
          respondedAt: new Date(),
        },
      },
    );

    res.send(result);
  }),
);

app.post(
  "/api/payments/confirm",
  verifyToken,
  verifyRole("tenant"),
  (req, res) => {
    res.status(501).send({
      error: true,
      message:
        "Payment verification is not configured. Verify the payment with your payment provider on the server before confirming.",
    });
  },
);

// Get transactions
app.get(
  "/api/transactions",
  verifyToken,
  verifyRole("tenant", "owner", "admin"),
  asyncHandler(async (req, res) => {
    const query = {};

    if (req.user.role === "tenant") {
      query.tenantId = req.user.id;
    }

    if (req.user.role === "owner") {
      query.ownerId = req.user.id;
    }

    if (req.user.role === "admin") {
      if (req.query.tenantId) {
        query.tenantId = req.query.tenantId;
      }

      if (req.query.ownerId) {
        query.ownerId = req.query.ownerId;
      }
    }

    const result = await transactionCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);
  }),
);
// ==========================================
// FAVORITE APIs
// ==========================================

// Get favorites
app.get(
  "/api/favorites",
  verifyToken,
  asyncHandler(async (req, res) => {
    const query = {
      userId: req.user.id,
    };

    if (req.query.propertyId) {
      query.propertyId = req.query.propertyId;
    }

    const result = await favoriteCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);
  }),
);

// Add favorite
app.post(
  "/api/favorites",
  verifyToken,
  asyncHandler(async (req, res) => {
    const { propertyId } = req.body;

    if (!isValidId(propertyId)) {
      return res.status(400).send({
        error: true,
        message: "Valid propertyId is required.",
      });
    }

    const property = await propertyCollection.findOne({
      _id: new ObjectId(propertyId),
      status: {
        $in: ["approved", "booked"],
      },
    });

    if (!property) {
      return res.status(404).send({
        error: true,
        message: "Property not found.",
      });
    }

    const userId = req.user.id;

    const alreadyAdded = await favoriteCollection.findOne({
      propertyId,
      userId,
    });

    if (alreadyAdded) {
      return res.status(409).send({
        error: true,
        message: "Already in your favorites.",
      });
    }

    const newFavorite = {
      propertyId,
      userId,
      title: property.title,
      location: property.location,
      type: property.type,
      price: property.price,
      image: property.images?.[0] || "",
      createdAt: new Date(),
    };

    const result = await favoriteCollection.insertOne(newFavorite);

    res.status(201).send({
      acknowledged: result.acknowledged,
      insertedId: result.insertedId,
    });
  }),
);

// Delete favorite
app.delete(
  "/api/favorites/:id",
  verifyToken,
  asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).send({
        error: true,
        message: "Invalid favorite id.",
      });
    }

    const result = await favoriteCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      userId: req.user.id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        error: true,
        message: "Favorite not found.",
      });
    }

    res.send(result);
  }),
);

// ==========================================
// ADMIN USER APIs
// ==========================================

// Get all users - Admin only
app.get(
  "/api/users",
  verifyToken,
  verifyRole("admin"),
  asyncHandler(async (req, res) => {
    const { role, search } = req.query;

    const query = {};

    if (role) {
      query.role = role;
    }

    if (search) {
      query.$or = [
        {
          name: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const result = await userCollection
      .find(query, {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);
  }),
);

// Update user role - Admin only
app.patch(
  "/api/users/:id/role",
  verifyToken,
  verifyRole("admin"),
  asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).send({
        error: true,
        message: "Invalid user id.",
      });
    }

    const { role } = req.body;

    if (!["tenant", "owner", "admin"].includes(role)) {
      return res.status(400).send({
        error: true,
        message: "Role must be tenant, owner or admin.",
      });
    }

    if (req.params.id === req.user.id) {
      return res.status(400).send({
        error: true,
        message: "You cannot change your own role.",
      });
    }

    const result = await userCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
      },
      {
        $set: {
          role,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        error: true,
        message: "User not found.",
      });
    }

    res.send(result);
  }),
);

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).send({
    error: true,
    message: "Internal server error.",
  });
});

// ==========================================
// MONGODB CONNECTION
// ==========================================

async function startServer() {
  try {
    await client.connect();

    const db = client.db("rentoraDB");

    propertyCollection = db.collection("properties");
    bookingCollection = db.collection("bookings");
    transactionCollection = db.collection("transactions");
    favoriteCollection = db.collection("favorites");

    userCollection = client
      .db(process.env.AUTH_DB_NAME || "rentoraDB")
      .collection("user");

    // jose is ESM, so load dynamically in CommonJS backend
    const jose = require("jose-cjs");

    jwtVerify = jose.jwtVerify;

    JWKS = jose.createRemoteJWKSet(new URL(`${CLIENT_URL}/api/auth/jwks`));

    app.listen(port, () => {
      console.log(`Rentora server running on port ${port}`);
      console.log("Connected to MongoDB");
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();
