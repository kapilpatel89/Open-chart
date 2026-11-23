# 🔐 Kotak Neo Zero-Storage Encrypted Relay (SEBI Whitelist Guide)

## 🎯 Architecture & Security Overview

Your cPanel server (`https://trade.ravikantadoor.in/simple/`) serves as a **Zero-Storage End-to-End Encrypted Order Relay** to satisfy SEBI's mandatory Static IP Whitelisting regulation:

1. **Zero Disk Storage (100% Stateless & Private):**
   - The relay script **does NOT write or store any files, databases, or logs** on your server.
   - All credentials and order packets exist only in server RAM for ~100ms during the active HTTP request, then are instantly destroyed by the PHP runtime.

2. **Military-Grade End-to-End Encryption (AES-256-CBC):**
   - All sensitive data (`consumer_key`, `mobile_number`, `ucc`, `totp`, `mpin`, and order parameters) are encrypted on your device using **AES-256-CBC** with a unique 16-byte random IV before transmission over HTTPS.
   - Even if someone intercepts the traffic, the payload is completely unreadable ciphertext.
   - The server decrypts in RAM, forwards to Kotak Securities API, encrypts Kotak's response, and sends it back to your device.

3. **Current Screen Kept 100% As-Is:**
   - No UI changes in your Mobile App or Desktop App.
   - You enter your standard credentials on the existing login screen, and the background pipeline automatically routes through your whitelisted relay.

---

## 🛠️ Step-by-Step Setup Guide

### Step 1: Upload Files to your `simple/` Folder
In your cPanel File Manager:
1. Navigate to the `simple/` folder (corresponding to `https://trade.ravikantadoor.in/simple/`).
2. Upload these files from `e:\Kotak AI traders\cpanel_relay\`:
   - `kotak_relay.php`
   - `index.php`
   - `get_my_ip.php`

---

### Step 2: Verify Relay & Get Whitelist IP
1. Open your browser and visit:
   ```
   https://trade.ravikantadoor.in/simple/kotak_relay.php?action=ping
   ```
2. You will see an instant JSON response:
   ```json
   {
       "status": "online",
       "service": "Kotak Neo Zero-Storage Encrypted Relay",
       "server_ip": "190.92.174.87",
       "stateless": true,
       "encryption": "AES-256-CBC"
   }
   ```
3. Copy the **`server_ip`** (e.g. `190.92.174.87`).

---

### Step 3: Whitelist the IP in Kotak Neo Portal
1. Log into your **Kotak Neo App** or **Kotak Neo Web Portal**.
2. Navigate to: **More** -> **Trade API** (or Invest -> Trade API).
3. Select your registered Trade API Application.
4. Click **"Add IP"** and paste your cPanel server's IP (`190.92.174.87`).
5. Save changes.

---

## 🔄 Complete Login & Order Execution Flow

```
Mobile App / Desktop App (Current Screen)
       │
       │ (1. User enters Consumer Key, Mobile, UCC, MPIN, TOTP)
       ▼
Local Client Engine
       │
       │ (2. Encrypts payload with AES-256-CBC + Random 16-byte IV)
       ▼
POST https://trade.ravikantadoor.in/simple/kotak_relay.php?action=login
       │
       ├─► (3. Server decrypts payload in RAM - Zero disk write)
       ├─► (4. Sends tradeApiLogin & tradeApiValidate to Kotak Securities)
       │       ※ Kotak verifies request originated from whitelisted IP 190.92.174.87!
       ├─► (5. Encrypts session tokens: edit_token, edit_sid, baseUrl)
       ▼
Mobile App receives authenticated session
       │
       │ (6. When placing order: Encrypts Order + Tokens)
       ▼
POST https://trade.ravikantadoor.in/simple/kotak_relay.php?action=place_order
       │
       ├─► (7. Server decrypts in RAM)
       ├─► (8. Dispatches quick/order/rule/ms/place to Kotak Neo)
       │       ※ Session IP matches Order IP! Order executed on NSE/BSE!
       ├─► (9. Encrypts exchange confirmation and returns to App)
       ▼
Order Filled on Mobile App!
```

---

## 🔒 Configuration & Passphrase

Both `cpanel_relay/kotak_relay.php` and `backend/kotak_relay_client.py` share the same default secret passphrase:
```php
define('RELAY_PASSPHRASE', 'kotak_algo_secret_relay_key_2026');
```
If you ever change this passphrase, make sure to update both files with the same string.
