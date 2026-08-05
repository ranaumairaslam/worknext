// src/modules/team-leader/teamLeader.routes.js

const express = require("express");
const router = express.Router();

const protect = require("../../middleware/auth.middleware");
const authorize = require("../../middleware/role.middleware");

const {
  getDashboard,
} = require("./TeamLeader.controller");

router.get(
  "/dashboard",
  protect,
  authorize("team_leader"),
  getDashboard
);

module.exports = router;