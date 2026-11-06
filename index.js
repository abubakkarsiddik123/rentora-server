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
      if (status) query.status = status;
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
        .find({ status: "available" })
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
        status: "available",
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
      if (property.status !== "available") {
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

    // payment related apis

app.post("/api/payments/confirm", async (req, res) => {
  const { bookingId, sessionId, amount } = req.body;

  if (!ObjectId.isValid(bookingId) || !sessionId) {
    return res
      .status(400)
      .send({ error: true, message: "bookingId and sessionId are required." });
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
    return res.status(404).send({ error: true, message: "Booking not found." });
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
