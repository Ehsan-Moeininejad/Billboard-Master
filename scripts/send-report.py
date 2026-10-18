"""Send the weekly report (.cache/report.html) through Gmail SMTP with an App Password.

Secrets (same names as the research-digest and ad-radar repos):
  SMTP_USER  Gmail address that sends
  SMTP_PASS  Gmail App Password (16 characters)
  MAIL_TO    one or more recipients, comma separated
Without them the report is skipped, so the data update never fails because of email.
"""
import os
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

user, pwd, to = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASS"), os.environ.get("MAIL_TO")
if not (user and pwd and to):
    print("SMTP_USER / SMTP_PASS / MAIL_TO not set; weekly email skipped.")
    sys.exit(0)

html = open(".cache/report.html", encoding="utf-8").read()
subject = open(".cache/report-subject.txt", encoding="utf-8").read().strip()
rcpt = [x.strip() for x in to.split(",") if x.strip()]

msg = MIMEMultipart("alternative")
msg["Subject"] = subject
msg["From"] = formataddr(("بیلبوردسنج", user))
msg["To"] = ", ".join(rcpt)
msg.attach(MIMEText("گزارش هفتگی بیلبوردسنج. برای دیدن جزئیات، ایمیل را در حالت HTML باز کنید.", "plain", "utf-8"))
msg.attach(MIMEText(html, "html", "utf-8"))

with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
    s.login(user, pwd)
    s.sendmail(user, rcpt, msg.as_string())
print(f"weekly email sent to {len(rcpt)} recipient(s)")
