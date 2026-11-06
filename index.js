// const express = require("express");
// const app = express();
// const cors = require("cors");
// require("dotenv").config();
// // const { MongoClient, ServerApiVersion } = require("mongodb");
// // const uri = process.env.MONGODB_URI;

// const { MongoClient, ObjectId } = require("mongodb");
// const port = process.env.PORT || 5005;

// app.use(cors());
// app.use(express.json());

// app.get("/", (req, res) => {
//   res.send("Hello World!");
// });

// const client = new MongoClient(process.env.MONGODB_URI);
// async function connectToMongoDB() {
//   try {
//     await client.connect();
//     const db = client.db("rentoraDB");

//     console.log("You successfully connected to MongoDB!");
//     return client;
//   } catch (err) {
//     console.dir(err);
//   }
// }
// // Call this only when your application terminates
// async function disconnectFromMongoDB() {
//   //   await client.close();
// }

// const starting = async () => {
//   await connectToMongoDB();

//   app.listen(port, () => {
//     console.log(`Example app listening on port ${port}`);
//   });
// };

// starting();

// notun sever

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

    app.get("/api/properties", async (req, res) => {
      try {
        const { ownerId, type, status } = req.query;

        const query = {};
        if (ownerId) query.ownerId = ownerId;
        if (type) query.type = type;
        if (status) query.status = status;

        const properties = await propertyCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(properties);
      } catch (err) {
        res
          .status(500)
          .send({ error: true, message: "Failed to load properties." });
      }
    });

    // একটা প্রপার্টি (Edit পেজ এটা দিয়ে ডাটা আনে)
    app.get("/api/properties/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ error: true, message: "Invalid property id." });
        }

        const property = await propertyCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!property) {
          return res
            .status(404)
            .send({ error: true, message: "Property not found." });
        }

        res.send(property);
      } catch (err) {
        res
          .status(500)
          .send({ error: true, message: "Failed to load property." });
      }
    });

    // আপডেট (Edit পেজের Save Changes, শুধু মালিক)
    app.patch("/api/properties/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ error: true, message: "Invalid property id." });
        }

        const { ownerId, ...fields } = req.body;

        // এই ফিল্ডগুলো এডিট করা যাবে না
        delete fields._id;
        delete fields.ownerEmail;
        delete fields.ownerName;
        delete fields.createdAt;

        if (fields.price !== undefined) fields.price = Number(fields.price);
        if (fields.bedrooms !== undefined)
          fields.bedrooms = Number(fields.bedrooms);
        if (fields.bathrooms !== undefined)
          fields.bathrooms = Number(fields.bathrooms);
        if (fields.area !== undefined) fields.area = Number(fields.area);

        const result = await propertyCollection.updateOne(
          { _id: new ObjectId(id), ownerId },
          { $set: { ...fields, updatedAt: new Date() } },
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            error: true,
            message: "Property not found or you are not the owner.",
          });
        }

        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ error: true, message: "Failed to update property." });
      }
    });

    // ডিলিট (My Properties পেজের Delete বাটন, শুধু মালিক)
    app.delete("/api/properties/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { ownerId } = req.query;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ error: true, message: "Invalid property id." });
        }

        const result = await propertyCollection.deleteOne({
          _id: new ObjectId(id),
          ownerId,
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({
            error: true,
            message: "Property not found or you are not the owner.",
          });
        }

        res.send(result);
      } catch (err) {
        res
          .status(500)
          .send({ error: true, message: "Failed to delete property." });
      }
    });

    app.post("/api/properties", async (req, res) => {
      const newProperty = {
        ...req.body,
        status: "available",
        createdAt: new Date(),
      };
      const result = await propertyCollection.insertOne(newProperty);
      res.status(201).send(result);
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
