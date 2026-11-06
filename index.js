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
