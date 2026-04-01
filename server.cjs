require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const User = require("./models/User.cjs");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((err) => console.log(err));

/* ===========================
        INSCRIPTION
=========================== */
app.post("/signup", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Champs manquants" });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      return res.status(400).json({ message: "Email ou pseudo déjà utilisé" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    });

    await newUser.save();

    res.json({ message: "Compte créé avec succès !" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/* ===========================
        LOGIN
=========================== */
app.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if ((!email && !username) || !password) {
      return res.status(400).json({ message: "Identifiants incomplets" });
    }

    const user = await User.findOne(email ? { email } : { username });

    if (!user) {
      return res.status(400).json({ message: "Utilisateur introuvable" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Mot de passe incorrect" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });

    res.json({
      message: "Connexion réussie",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

/* ===========================
      ROUTE PROTÉGÉE TEST
=========================== */
app.get("/profile", async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Non autorisé" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    res.json(user);
  } catch {
    res.status(401).json({ message: "Token invalide" });
  }
});

const PORT = process.env.PORT || 3000;
if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.warn(
    "⚠️ Variables d'environnement manquantes : MONGO_URI et/ou JWT_SECRET",
  );
}

app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});
