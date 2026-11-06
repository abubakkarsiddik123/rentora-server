const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ObjectId } = require("mongodb");
const client = new MongoClient(process.env.MONGODB_URI);

const port = process.env.PORT || 5005;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Rentora server running");
});

async function connectToMongoDB() {
  try {
    await client.connect();

    const db = client.db("rentoraDB");
    const propertyCollection = db.collection("properties");
    const bookingCollection = db.collection("bookings");
    const transactionCollection = db.collection("transactions");
    const favoriteCollection = db.collection("favorites");
    // Better Auth-এর ইউজার কালেকশন। ডাটাবেস আলাদা হলে .env-এ AUTH_DB_NAME দিন
    const userCollection = client
      .db(process.env.AUTH_DB_NAME || "rentoraDB")
      .collection("user");

    // property related apis
    app.get("/api/properties", async (req, res) => {
      const {
        search,
        location,
        type,
        status,
        ownerId,
        minPrice,
        maxPrice,
        bedrooms,
        sort,
      } = req.query;

      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 9, 1), 50);
      const skip = (page - 1) * limit;

      const query = {};
      if (ownerId) query.ownerId = ownerId;
      if (status) {
        query.status = status;
      } else if (!ownerId) {
        query.status = "approved"; // পাবলিক তালিকায় শুধু approved
      }
      if (type) query.type = type;
      if (location) query.location = { $regex: location, $options: "i" };
      if (bedrooms) query.bedrooms = { $gte: Number(bedrooms) };
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
    });

    // অবশ্যই "/:id"-এর আগে থাকতে হবে
    app.get("/api/properties/featured", async (req, res) => {
      const result = await propertyCollection
        .find({ status: "approved" })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    app.get("/api/properties/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .send({ error: true, message: "Invalid property id." });
      }
      const query = { _id: new ObjectId(req.params.id) };
      const result = await propertyCollection.findOne(query);

      if (!result) {
        return res
          .status(404)
          .send({ error: true, message: "Property not found." });
      }
      res.send(result);
    });

    app.post("/api/properties", async (req, res) => {
      const newProperty = {
        ...req.body,
        status: "pending",
        rejectionReason: "",
        featured: false,
        createdAt: new Date(),
      };
      const result = await propertyCollection.insertOne(newProperty);
      res.status(201).send(result);
    });

    // শুধু মালিক আপডেট করতে পারবে
    app.patch("/api/properties/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .send({ error: true, message: "Invalid property id." });
      }
      const { ownerId, ...fields } = req.body;

      delete fields._id;
      delete fields.ownerEmail;
      delete fields.ownerName;
      delete fields.createdAt;
      delete fields.featured;
      delete fields.status; // Owner নিজে approved করতে পারবে না
      delete fields.rejectionReason;

      const query = { _id: new ObjectId(req.params.id), ownerId };
      const result = await propertyCollection.updateOne(query, {
        $set: { ...fields, updatedAt: new Date() },
      });

      if (result.matchedCount === 0) {
        return res.status(404).send({
          error: true,
          message: "Property not found or you are not the owner.",
        });
      }
      res.send(result);
    });

    // Admin: approve / reject
    // (JWT ধাপে এখানে verifyRole("admin") বসবে)
    app.patch("/api/properties/:id/status", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .send({ error: true, message: "Invalid property id." });
      }
      const { status, rejectionReason } = req.body;

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).send({
          error: true,
          message: "Status must be approved or rejected.",
        });
      }
      if (status === "rejected" && !rejectionReason?.trim()) {
        return res
          .status(400)
          .send({ error: true, message: "Rejection reason is required." });
      }

      const result = await propertyCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $set: {
            status,
            rejectionReason:
              status === "rejected" ? rejectionReason.trim() : "",
            updatedAt: new Date(),
          },
        },
      );
      if (result.matchedCount === 0) {
        return res
          .status(404)
          .send({ error: true, message: "Property not found." });
      }
      res.send(result);
    });

    // শুধু মালিক ডিলিট করতে পারবে
    app.delete("/api/properties/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .send({ error: true, message: "Invalid property id." });
      }
      const query = {
        _id: new ObjectId(req.params.id),
        ownerId: req.query.ownerId,
      };
      const result = await propertyCollection.deleteOne(query);

      if (result.deletedCount === 0) {
        return res.status(404).send({
          error: true,
          message: "Property not found or you are not the owner.",
        });
      }
      res.send(result);
    });

    // booking related apis

    app.get("/api/bookings", async (req, res) => {
      const query = {};
      if (req.query.tenantId) query.tenantId = req.query.tenantId;
      if (req.query.ownerId) query.ownerId = req.query.ownerId;
      if (req.query.propertyId) query.propertyId = req.query.propertyId;
      if (req.query.status) query.status = req.query.status;

      const result = await bookingCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/api/bookings/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .send({ error: true, message: "Invalid booking id." });
      }
      const result = await bookingCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!result) {
        return res
          .status(404)
          .send({ error: true, message: "Booking not found." });
      }
      res.send(result);
    });

    app.post("/api/bookings", async (req, res) => {
      const {
        propertyId,
        tenantId,
        tenantName,
        tenantEmail,
        moveInDate,
        phone,
        notes,
      } = req.body;

      if (!ObjectId.isValid(propertyId) || !tenantId || !moveInDate || !phone) {
        return res.status(400).send({
          error: true,
          message: "propertyId, tenantId, moveInDate and phone are required.",
        });
      }

      const property = await propertyCollection.findOne({
        _id: new ObjectId(propertyId),
      });
      if (!property) {
        return res
          .status(404)
          .send({ error: true, message: "Property not found." });
      }
      if (property.status !== "approved") {
        return res
          .status(400)
          .send({ error: true, message: "This property is not available." });
      }
      if (property.ownerId === tenantId) {
        return res
          .status(400)
          .send({ error: true, message: "You cannot book your own property." });
      }

      // একই ইউজারের একই প্রপার্টিতে সক্রিয় বুকিং থাকলে আবার নয়
      const existing = await bookingCollection.findOne({
        propertyId,
        tenantId,
        status: { $in: ["pending", "approved"] },
      });
      if (existing) {
        // পেমেন্ট বাকি থাকলে সেই বুকিংয়েই ফেরত পাঠাই
        if (existing.paymentStatus === "unpaid") {
          return res.send({ insertedId: existing._id, existing: true });
        }
        return res
          .status(409)
          .send({ error: true, message: "You already booked this property." });
      }

      const newBooking = {
        propertyId,
        propertyTitle: property.title,
        propertyImage: property.images?.[0] || "",
        ownerId: property.ownerId,
        ownerName: property.ownerName,
        ownerEmail: property.ownerEmail,
        tenantId,
        tenantName,
        tenantEmail,
        moveInDate,
        phone,
        notes: notes || "",
        amount: Math.round(Number(property.price) * 0.1), // সার্ভার নিজে দাম বসায়, ক্লায়েন্টের ওপর ভরসা নেই
        status: "pending",
        paymentStatus: "unpaid",
        createdAt: new Date(),
      };

      const result = await bookingCollection.insertOne(newBooking);
      res.status(201).send(result);
    });

    // Owner: বুকিং approve / reject
    // (JWT ধাপে ownerId টোকেন থেকে নেওয়া হবে, আর verifyRole("owner") বসবে)
    app.patch("/api/bookings/:id/status", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .send({ error: true, message: "Invalid booking id." });
      }
      const { ownerId, status } = req.body;

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).send({
          error: true,
          message: "Status must be approved or rejected.",
        });
      }

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(req.params.id),
        ownerId,
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
            message:
              "Tenant has not paid yet. You cannot approve this booking.",
          });
        }

        // প্রপার্টি এখনও approved থাকলেই booked করা যাবে
        const propertyResult = await propertyCollection.updateOne(
          { _id: new ObjectId(booking.propertyId), status: "approved" },
          { $set: { status: "booked", updatedAt: new Date() } },
        );
        if (propertyResult.matchedCount === 0) {
          return res.status(409).send({
            error: true,
            message: "This property is no longer available.",
          });
        }

        // একই প্রপার্টির বাকি pending বুকিং স্বয়ংক্রিয়ভাবে rejected
        await bookingCollection.updateMany(
          {
            propertyId: booking.propertyId,
            _id: { $ne: booking._id },
            status: "pending",
          },
          { $set: { status: "rejected", respondedAt: new Date() } },
        );
      }

      const result = await bookingCollection.updateOne(
        { _id: booking._id },
        { $set: { status, respondedAt: new Date() } },
      );
      res.send(result);
    });

    // payment related apis

    app.post("/api/payments/confirm", async (req, res) => {
      const { bookingId, sessionId, amount } = req.body;

      if (!ObjectId.isValid(bookingId) || !sessionId) {
        return res.status(400).send({
          error: true,
          message: "bookingId and sessionId are required.",
        });
      }

      // একই sessionId দুইবার সেভ হবে না (রিলোড করলেও)
      const already = await transactionCollection.findOne({ sessionId });
      if (already) {
        return res.send({ alreadyConfirmed: true });
      }

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(bookingId),
      });
      if (!booking) {
        return res
          .status(404)
          .send({ error: true, message: "Booking not found." });
      }

      await bookingCollection.updateOne(
        { _id: booking._id },
        { $set: { paymentStatus: "paid", paidAt: new Date() } },
      );

      const transaction = {
        transactionId: sessionId,
        sessionId,
        bookingId,
        propertyId: booking.propertyId,
        propertyTitle: booking.propertyTitle,
        tenantId: booking.tenantId,
        tenantName: booking.tenantName,
        ownerId: booking.ownerId,
        ownerName: booking.ownerName,
        amount: Number(amount) || booking.amount,
        createdAt: new Date(),
      };
      const result = await transactionCollection.insertOne(transaction);
      res.status(201).send(result);
    });

    app.get("/api/transactions", async (req, res) => {
      const query = {};
      if (req.query.ownerId) query.ownerId = req.query.ownerId;
      if (req.query.tenantId) query.tenantId = req.query.tenantId;

      const result = await transactionCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // favorite related apis

    app.get("/api/favorites", async (req, res) => {
      const query = {};
      if (req.query.userId) query.userId = req.query.userId;
      if (req.query.propertyId) query.propertyId = req.query.propertyId;

      const result = await favoriteCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.post("/api/favorites", async (req, res) => {
      const { propertyId, userId } = req.body;

      if (!ObjectId.isValid(propertyId) || !userId) {
        return res.status(400).send({
          error: true,
          message: "propertyId and userId are required.",
        });
      }

      const property = await propertyCollection.findOne({
        _id: new ObjectId(propertyId),
      });
      if (!property) {
        return res
          .status(404)
          .send({ error: true, message: "Property not found." });
      }

      const alreadyAdded = await favoriteCollection.findOne({
        propertyId,
        userId,
      });
      if (alreadyAdded) {
        return res
          .status(409)
          .send({ error: true, message: "Already in your favorites." });
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
      res.status(201).send(result);
    });

    app.delete("/api/favorites/:id", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .send({ error: true, message: "Invalid favorite id." });
      }
      const query = {
        _id: new ObjectId(req.params.id),
        userId: req.query.userId,
      };
      const result = await favoriteCollection.deleteOne(query);

      if (result.deletedCount === 0) {
        return res
          .status(404)
          .send({ error: true, message: "Favorite not found." });
      }
      res.send(result);
    });

    // user related apis (Admin)
    // (JWT ধাপে এই দুটো রুটে verifyRole("admin") বসবে)
    app.get("/api/users", async (req, res) => {
      const { role, search } = req.query;

      const query = {};
      if (role) query.role = role;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }

      const result = await userCollection
        .find(query, {
          projection: { name: 1, email: 1, image: 1, role: 1, createdAt: 1 },
        })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/api/users/:id/role", async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .send({ error: true, message: "Invalid user id." });
      }
      const { role } = req.body;

      if (!["tenant", "owner", "admin"].includes(role)) {
        return res.status(400).send({
          error: true,
          message: "Role must be tenant, owner or admin.",
        });
      }

      const result = await userCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role, updatedAt: new Date() } },
      );
      if (result.matchedCount === 0) {
        return res
          .status(404)
          .send({ error: true, message: "User not found." });
      }
      res.send(result);
    });

    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const starting = async () => {
  await connectToMongoDB();

  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
};

starting();
