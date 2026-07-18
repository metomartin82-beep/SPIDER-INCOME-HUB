const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // true for port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const sendOTP = async (toEmail, toName, otp) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'SPIDERHUB INNOVATIONS- Your OTP Code',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0a0f1e;color:#fff;border-radius:12px;padding:32px;">
        <h2 style="color:#00e5ff;margin-bottom:8px;">SPIDER INNOVATIONS 🔐</h2>
        <p>Hello <strong>${toName}</strong>,</p>
        <p>here is your  verification code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#00e5ff;text-align:center;padding:20px;background:#111827;border-radius:8px;margin:20px 0;">
          ${otp}
        </div>
        <p style="color:#aaa;font-size:13px;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="color:#555;font-size:12px;margin-top:24px;">— SPIDER LABS INNOVATIONS </p>
      </div>
    `
  });
};

const sendVerification = async (toEmail, toName, otp, verifyLink) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'SpiderHub - Verify Your Account',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0a0f1e;color:#fff;border-radius:12px;padding:32px;">
        <h2 style="color:#00e5ff;margin-bottom:8px;">Welcome to SPIDERHUB 👋</h2>
        <p>Hi <strong>${toName}</strong>, thanks for signing up!</p>
        <p>Click the button below to verify your account — it'll take you straight back into the app:</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${verifyLink}" style="display:inline-block;background:linear-gradient(135deg,#0066FF,#00D9FF);color:#0a0f1e;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;">Verify My Account</a>
        </div>
        <p style="color:#aaa;font-size:12px;text-align:center;">Or copy this link into your browser:<br><span style="color:#00e5ff;word-break:break-all;">${verifyLink}</span></p>
        <p style="color:#aaa;font-size:13px;margin-top:20px;">Prefer typing a code broe? Use this one in the app:</p>
        <div style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#00e5ff;text-align:center;padding:16px;background:#111827;border-radius:8px;margin:12px 0;">
          ${otp}
        </div>
        <p style="color:#aaa;font-size:13px;">Both the link and the code expire in <strong>24 hours</strong>.</p>
        <p style="color:#555;font-size:12px;margin-top:24px;">— SPIDER INNOVATIONS </p>
      </div>
    `
  });
};

module.exports = { sendOTP, sendVerification };
