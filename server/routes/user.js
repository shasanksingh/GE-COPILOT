import { Router } from "express";
import { db } from "./../db/connection.js";
import collections from "../db/collections.js";
import { ObjectId } from "mongodb";
import nodemailer from "nodemailer";
import sendMail from "../mail/send.js";
import user from "../helpers/user.js";
import jwt from "jsonwebtoken";
import axios from "axios";
import fs from "fs";
import path from "path";
let router = Router();

const CheckLogged = async (req, res, next) => {
  const token = req.cookies.userToken;

  jwt.verify(token, process.env.JWT_PRIVATE_KEY, async (err, decoded) => {
    if (decoded) {
      let userData = null;

      try {
        userData = await user.checkUserFound(decoded);
      } catch (err) {
        if (err?.notExists) {
          res.clearCookie("userToken");
          next();
        } else {
          res.status(500).json({
            status: 500,
            message: err,
          });
        }
      } finally {
        if (userData) {
          delete userData.pass;
          res.status(208).json({
            status: 208,
            message: "Already Logged",
            data: userData,
          });
        }
      }
    } else {
      next();
    }
  });
};

// Route to update user profile information
router.post("/update_profile", async (req, res) => {
  const { email, firstName, lastName, profilePicture } = req.body;
  const done = await db.collection(collections.USER).updateOne(
    { email },
    {
      $set: {
        fName: firstName,
        lName: lastName,
        profilePicture: profilePicture,
      },
    }
  );
});

// Route to check if a user is logged in
router.get("/checkLogged", CheckLogged, (req, res) => {
  res.status(405).json({
    status: 405,
    message: "Not Logged",
  });
});

// Route to handle user signup
router.post("/signup", CheckLogged, async (req, res) => {
  const Continue = async () => {
    let response = null;
    req.body.pending = true;

    try {
      response = await user.signup(req.body);
    } catch (err) {
      if (err?.exists) {
        res.status(400).json({
          status: 400,
          message: err,
        });
      } else {
        res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response?.manual) {
        fs.readFile(
          `${path.resolve(path.dirname(""))}/mail/template.html`,
          "utf8",
          (err, html) => {
            if (!err) {
              html = html.replace(
                "[URL]",
                `${process.env.SITE_URL}/signup/pending/${response._id}`
              );
              html = html.replace("[TITLE]", "Verify your email address");
              html = html.replace(
                "[CONTENT]",
                "To continue setting up your GE CoPilot™ account, please verify that this is your email address."
              );
              html = html.replace("[BTN_NAME]", "Verify email address");

              sendMail({
                to: req.body.email,
                subject: `GE CoPilot™ - Verify your email`,
                html,
              });
            } else {
              console.log(err);
            }
          }
        );

        res.status(200).json({
          status: 200,
          message: "Success",
          data: {
            _id: null,
            manual: response.manual || false,
          },
        });
      } else if (response) {
        res.status(200).json({
          status: 200,
          message: "Success",
          data: {
            _id: response._id,
            manual: response.manual || false,
          },
        });
      }
    }
  };

  if (req.body?.manual === false) {
    let response = null;
    try {
      response = await axios.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: {
            Authorization: `Bearer ${req.body.token}`,
          },
        }
      );
    } catch (err) {
      res.status(500).json({
        status: 500,
        message: err,
      });
    } finally {
      if (response?.data.email_verified) {
        if (req.body?.email === response?.data.email) {
          Continue();
        } else {
          res.status(422).json({
            status: 422,
            message: "Something Wrong",
          });
        }
      }
    }
  } else if (req.body?.email) {
    if (req.body?.pass.length >= 8) {
      req.body.email = req.body.email.toLowerCase();

      Continue();
    } else {
      res.status(422).json({
        status: 422,
        message: "Password must 8 character",
      });
    }
  } else {
    res.status(422).json({
      status: 422,
      message: "Enter email",
    });
  }
});

// Route to check if a signup request is pending
router.get("/checkPending", CheckLogged, async (req, res) => {
  const { _id } = req.query;
  let response = null;
  if (_id?.length === 24) {
    try {
      response = await user.checkPending(_id);
    } catch (err) {
      if (err?.status === 422) {
        res.status(422).json({
          status: 422,
          message: err?.text,
        });
      } else if (err?.status === 404) {
        res.status(404).json({
          status: 404,
          message: err?.text,
        });
      } else {
        res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response) {
        res.status(200).json({
          status: 200,
          message: "Success",
          data: response,
        });
      }
    }
  } else {
    res.status(404).json({
      status: 404,
      message: "Not found",
    });
  }
});

// Route to complete the signup process for pending users
router.put("/signup-finish", CheckLogged, async (req, res) => {
  let response = null;
  try {
    response = await user.finishSignup(req.body);
  } catch (err) {
    if (err?.status === 422) {
      res.status(422).json({
        status: 422,
        message: "Already Registered",
      });
    } else {
      res.status(500).json({
        status: 500,
        message: err,
      });
    }
  } finally {
    if (response) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: response,
      });
    }
  }
});

// Route to handle user login
router.get("/login", CheckLogged, async (req, res) => {
  const Continue = async () => {
    let response = null;
    try {
      response = await user.login(req.query);
    } catch (err) {
      if (err?.status === 422) {
        res.status(422).json({
          status: 422,
          message: "Email or password wrong",
        });
      } else {
        res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response) {
        res.status(200).json({
          status: 200,
          message: "Success",
          data: response,
        });
      }
    }
  };

  if (req.query?.manual === "false") {
    let response = null;
    try {
      response = await axios.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: {
            Authorization: `Bearer ${req.query.token}`,
          },
        }
      );
    } catch (err) {
      res.status(500).json({
        status: 500,
        message: err,
      });
    } finally {
      if (response?.data.email_verified) {
        req.query.email = response?.data.email;
        Continue();
      }
    }
  } else if (req.query?.email && req.query?.pass) {
    req.query.email = req.query.email.toLowerCase();
    Continue();
  } else {
    res.status(422).json({
      status: 422,
      message: "Email or password wrong",
    });
  }
});

// Route to initiate a password reset request
router.post("/forgot-request", CheckLogged, async (req, res) => {
  if (req.body?.email) {
    let secret = Math.random().toString(16);
    secret = secret.replace("0.", "");
    let response = null;
    try {
      response = await user.forgotRequest(req.body, secret);
    } catch (err) {
      if (err?.status === 422) {
        res.status(422).json({
          status: 422,
          message: "Email wrong",
        });
      } else {
        res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response) {
        fs.readFile(
          `${path.resolve(path.dirname(""))}/mail/template.html`,
          "utf8",
          (err, html) => {
            if (!err) {
              html = html.replace(
                "[URL]",
                `${process.env.SITE_URL}/forgot/pending/${response.userID}/${secret}`
              );
              html = html.replace("[TITLE]", "Change your password");
              html = html.replace(
                "[CONTENT]",
                "To change your GE CoPilot™ account password, please click the button below and follow the instructions."
              );
              html = html.replace("[BTN_NAME]", "Change your password");

              sendMail({
                to: req.body.email,
                subject: `GE CoPilot™ - Change your password`,
                html,
              });
            }
          }
        );

        res.status(200).json({
          status: 200,
          message: "Success",
        });
      }
    }
  } else {
    res.status(422).json({
      status: 422,
      message: "Enter email",
    });
  }
});

// Route to check the validity of the password reset request
router.get("/forgot-check", CheckLogged, async (req, res) => {
  const { _id, secret } = req.query;
  let response = null;

  if (_id?.length === 24 && secret?.length === 13) {
    try {
      response = await user.forgotCheck(req.query);
    } catch (err) {
      if (err?.status === 404) {
        res.status(404).json({
          status: 404,
          message: err.text,
        });
      } else {
        res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response) {
        res.status(200).json({
          status: 200,
          message: "Success",
        });
      }
    }
  } else {
    res.status(404).json({
      status: 404,
      message: "Not found",
    });
  }
});

// Route to complete the password reset process
router.put("/forgot-finish", CheckLogged, async (req, res) => {
  let response = null;
  try {
    response = await user.forgotFinish(req.body);
  } catch (err) {
    if (err?.status === 422) {
      res.status(422).json({
        status: 422,
        message: "Already Registered",
      });
    } else {
      res.status(500).json({
        status: 500,
        message: err,
      });
    }
  } finally {
    if (response) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: response,
      });
    }
  }
});

// Route to check if a user is logged in and respond with status 405 if not
router.get("/checkUserLogged", CheckLogged, (req, res) => {
  res.status(405).json({
    status: 405,
    message: "Not Logged",
  });
});

// Route to delete a user's account
router.delete("/account", CheckLogged, async (req, res) => {
  let response = null;
  try {
    response = await user.deleteAccount(req.query);
  } catch (err) {
    if (err?.status === 422) {
      res.status(422).json({
        status: 422,
        message: err.text,
      });
    } else {
      res.status(500).json({
        status: 500,
        message: err,
      });
    }
  } finally {
    if (response) {
      res.clearCookie("userToken");
      res.status(200).json({
        status: 200,
        message: "Success",
      });
    }
  }
});

// Route to send an OTP to the user's email
router.post("/otp", CheckLogged, async (req, res) => {
  if (req.body?.email) {
    let secret = Math.random().toString(16);
    secret = secret.replace("0.", "");
    let response = null;
    try {
      response = await user.sendOTP(req.body, secret);
    } catch (err) {
      if (err?.status === 422) {
        res.status(422).json({
          status: 422,
          message: "Email wrong",
        });
      } else {
        res.status(500).json({
          status: 500,
          message: err,
        });
      }
    } finally {
      if (response) {
        fs.readFile(
          `${path.resolve(path.dirname(""))}/mail/template.html`,
          "utf8",
          (err, html) => {
            if (!err) {
              html = html.replace(
                "[OTP]",
                `${response.otp}`
              );
              html = html.replace("[TITLE]", "Your OTP Code");
              html = html.replace(
                "[CONTENT]",
                "To verify your GE CoPilot™ account, please use the following OTP code."
              );
              html = html.replace("[BTN_NAME]", "Use OTP Code");

              sendMail({
                to: req.body.email,
                subject: `GE CoPilot™ - Your OTP Code`,
                html,
              });
            }
          }
        );

        res.status(200).json({
          status: 200,
          message: "Success",
        });
      }
    }
  } else {
    res.status(422).json({
      status: 422,
      message: "Enter email",
    });
  }
});

// Route to send an OTP and store it in the temporary collection
router.post("/send_otp", CheckLogged, async (req, res) => {
  const { email } = req.body;
  let response = null;
  let otp = Math.floor(100000 + Math.random() * 900000);
  try {
    response = await db.collection(collections.TEMP_OTP).insertOne({
      email,
      otp,
      createdAt: new Date(),
    });
  } catch (err) {
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response) {
      sendMail({
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP code is ${otp}`,
      });

      res.status(200).json({
        status: 200,
        message: "OTP sent",
      });
    }
  }
});

// Route to verify the OTP sent to the user's email
router.post("/verify_otp", CheckLogged, async (req, res) => {
  const { email, otp } = req.body;
  let response = null;
  try {
    response = await db.collection(collections.TEMP_OTP).findOneAndDelete({
      email,
      otp: parseInt(otp),
    });
  } catch (err) {
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response?.value) {
      const userToken = jwt.sign({ email }, process.env.JWT_PRIVATE_KEY, {
        expiresIn: "1h",
      });
      res.cookie("userToken", userToken, { httpOnly: true });

      res.status(200).json({
        status: 200,
        message: "OTP verified",
      });
    } else {
      res.status(401).json({
        status: 401,
        message: "Invalid OTP",
      });
    }
  }
});

// Route to log out the user
router.get("/logout", (req, res) => {
  res.clearCookie("userToken");
  res.status(200).json({
    status: 200,
    message: "Logged out",
  });
});

export default router;
