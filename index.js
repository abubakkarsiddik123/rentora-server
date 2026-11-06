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

    // property related apis

    // অবশ্যই "/:id"-এর আগে থাকতে হবে
    app.get("/api/properties/featured", async (req, res) => {
      const result = await propertyCollection
        .find({ status: "available" })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    app.get("/api/properties", async (req, res) => {
      const query = {};
      if (req.query.ownerId) query.ownerId = req.query.ownerId;
      if (req.query.type) query.type = req.query.type;
      if (req.query.status) query.status = req.query.status;

      const result = await propertyCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/api/properties/:id", async (req, res) => {
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
