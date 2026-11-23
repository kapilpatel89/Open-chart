"""
Kotak Neo cPanel Encrypted Relay Client for Open Chart
Zero-Storage & Military-Grade End-to-End Encrypted (AES-256-CBC).
Communicates with: https://trade.ravikantadoor.in/simple/kotak_relay.php
Enables SEBI-mandated static IP whitelisting for all 2FA logins & live orders.
"""

import os
import json
import base64
import hashlib
import logging
from typing import Dict, Any, Optional

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding

logger = logging.getLogger("kotak_relay_client")

# Defaults configured for user's cPanel server
DEFAULT_RELAY_URL = "https://trade.ravikantadoor.in/simple/kotak_relay.php"
DEFAULT_RELAY_PASSPHRASE = "kotak_algo_secret_relay_key_2026"


class KotakRelayClient:
    """
    Zero-Storage Encrypted Relay Client for Kotak Neo Trade API.
    All credentials and order parameters are encrypted with AES-256-CBC
    before leaving the client, satisfying Kotak Neo's Static IP Whitelisting
    regulations without exposing credentials in plaintext.
    """

    def __init__(
        self,
        relay_url: str = DEFAULT_RELAY_URL,
        passphrase: str = DEFAULT_RELAY_PASSPHRASE
    ):
        self.relay_url = (relay_url or DEFAULT_RELAY_URL).rstrip("/")
        self.passphrase = passphrase or DEFAULT_RELAY_PASSPHRASE
        # Derive 32-byte AES key via SHA-256
        self.aes_key = hashlib.sha256(self.passphrase.encode("utf-8")).digest()

    def encrypt_payload(self, data: Dict[str, Any]) -> str:
        """Encrypts dictionary payload using AES-256-CBC with random 16-byte IV."""
        plaintext = json.dumps(data).encode("utf-8")
        iv = os.urandom(16)
        padder = padding.PKCS7(128).padder()
        padded = padder.update(plaintext) + padder.finalize()
        cipher = Cipher(algorithms.AES(self.aes_key), modes.CBC(iv))
        encryptor = cipher.encryptor()
        ciphertext = encryptor.update(padded) + encryptor.finalize()
        # Prepend 16-byte IV to ciphertext and base64-encode
        return base64.b64encode(iv + ciphertext).decode("utf-8")

    def decrypt_payload(self, base64_str: str) -> Optional[Dict[str, Any]]:
        """Decrypts AES-256-CBC payload returned from relay server."""
        try:
            raw = base64.b64decode(base64_str.encode("utf-8"))
            if len(raw) < 17:
                return None
            iv = raw[:16]
            ciphertext = raw[16:]
            cipher = Cipher(algorithms.AES(self.aes_key), modes.CBC(iv))
            decryptor = cipher.decryptor()
            padded = decryptor.update(ciphertext) + decryptor.finalize()
            unpadder = padding.PKCS7(128).unpadder()
            plaintext = unpadder.update(padded) + unpadder.finalize()
            return json.loads(plaintext.decode("utf-8"))
        except Exception as e:
            logger.error("Decryption error in relay response: %s", e)
            return None

    def _post_encrypted(self, action: str, data: Dict[str, Any], timeout: int = 15) -> Dict[str, Any]:
        """Sends encrypted envelope and returns decrypted JSON response."""
        try:
            encrypted_body = self.encrypt_payload(data)
            url = f"{self.relay_url}?action={action}"
            res = requests.post(
                url,
                json={"payload": encrypted_body},
                headers={"Content-Type": "application/json"},
                timeout=timeout
            )
            if not res.ok:
                return {
                    "status": "error",
                    "http_code": res.status_code,
                    "message": f"Relay HTTP {res.status_code}: {res.text[:200]}"
                }

            resp_json = res.json()
            if "payload" in resp_json:
                decrypted = self.decrypt_payload(resp_json["payload"])
                return decrypted or {"status": "error", "message": "Failed to decrypt server reply"}
            return resp_json
        except requests.exceptions.RequestException as e:
            logger.error("Relay request failed for action=%s: %s", action, e)
            return {"status": "error", "message": f"Relay connection error: {str(e)}"}
        except Exception as e:
            return {"status": "error", "message": f"Relay error: {str(e)}"}

    def ping(self) -> Dict[str, Any]:
        """Health check returning relay server status and outbound static IP."""
        try:
            r = requests.get(f"{self.relay_url}?action=ping", timeout=8)
            return r.json()
        except Exception as e:
            return {"status": "error", "message": str(e), "server_ip": "Unavailable"}

    def login(
        self,
        consumer_key: str,
        mobile_number: str,
        ucc: str,
        totp: str,
        mpin: str
    ) -> Dict[str, Any]:
        """
        Executes Kotak Neo TOTP Login and MPIN Validation via the whitelisted cPanel static IP.
        Kotak Neo strictly binds the session to this IP!
        """
        clean_key = consumer_key.strip()
        if clean_key.lower().startswith("bearer "):
            clean_key = clean_key[7:].strip()

        payload = {
            "consumer_key": clean_key,
            "mobile_number": mobile_number.strip(),
            "ucc": ucc.strip().upper(),
            "totp": totp.strip(),
            "mpin": mpin.strip()
        }
        return self._post_encrypted("login", payload, timeout=20)

    def place_order(
        self,
        edit_token: str,
        edit_sid: str,
        base_url: str,
        symbol: str,
        transaction_type: str,
        quantity: int,
        order_type: str = "MKT",
        price: float = 0.0,
        trigger_price: float = 0.0,
        product: str = "MIS",
        exchange_segment: str = "nse_fo",
        tag: str = "open_chart_relay",
        validity: str = "DAY",
        amo: str = "NO",
        consumer_key: str = ""
    ) -> Dict[str, Any]:
        """
        Places live order on NSE/BSE through whitelisted cPanel static IP.
        Auto-generates fresh unique client order ID ('ig') and resolves candidate symbols.
        """
        payload = {
            "edit_token": edit_token,
            "edit_sid": edit_sid,
            "base_url": base_url,
            "consumer_key": consumer_key,
            "order": {
                "symbol": symbol,
                "transaction_type": transaction_type.upper(),
                "quantity": quantity,
                "order_type": order_type.upper(),
                "price": price,
                "trigger_price": trigger_price,
                "product": product.upper(),
                "exchange_segment": exchange_segment,
                "validity": validity,
                "amo": amo,
                "tag": tag
            }
        }
        return self._post_encrypted("place_order", payload, timeout=15)

    def exit_position(
        self,
        edit_token: str,
        edit_sid: str,
        base_url: str,
        symbol: str,
        quantity: int,
        transaction_type: str = "SELL",
        product: str = "MIS",
        exchange_segment: str = "nse_fo"
    ) -> Dict[str, Any]:
        """Squares off an open position via the whitelisted relay."""
        payload = {
            "edit_token": edit_token,
            "edit_sid": edit_sid,
            "base_url": base_url,
            "exit": {
                "symbol": symbol,
                "quantity": quantity,
                "transaction_type": transaction_type.upper(),
                "product": product.upper(),
                "exchange_segment": exchange_segment
            }
        }
        return self._post_encrypted("exit_position", payload, timeout=12)

    def cancel_order(
        self,
        edit_token: str,
        edit_sid: str,
        base_url: str,
        order_id: str
    ) -> Dict[str, Any]:
        """Cancels an open order through cPanel whitelisted static IP."""
        payload = {
            "edit_token": edit_token,
            "edit_sid": edit_sid,
            "base_url": base_url,
            "order_id": order_id
        }
        return self._post_encrypted("cancel_order", payload, timeout=10)

    def modify_order(
        self,
        edit_token: str,
        edit_sid: str,
        base_url: str,
        order_id: str,
        symbol: str,
        transaction_type: str,
        quantity: int,
        order_type: str,
        price: float,
        trigger_price: float = 0.0,
        exchange_segment: str = "nse_fo"
    ) -> Dict[str, Any]:
        """Modifies order through cPanel whitelisted static IP."""
        payload = {
            "edit_token": edit_token,
            "edit_sid": edit_sid,
            "base_url": base_url,
            "modify": {
                "order_id": order_id,
                "symbol": symbol,
                "transaction_type": transaction_type.upper(),
                "quantity": quantity,
                "order_type": order_type.upper(),
                "price": price,
                "trigger_price": trigger_price,
                "exchange_segment": exchange_segment
            }
        }
        return self._post_encrypted("modify_order", payload, timeout=10)

    def get_limits(
        self,
        edit_token: str,
        edit_sid: str,
        base_url: str,
        consumer_key: str = ""
    ) -> Dict[str, Any]:
        """Fetches live margins and cash balance from Kotak Neo."""
        payload = {
            "edit_token": edit_token,
            "edit_sid": edit_sid,
            "base_url": base_url,
            "consumer_key": consumer_key
        }
        return self._post_encrypted("limits", payload, timeout=10)

    def get_positions(
        self,
        edit_token: str,
        edit_sid: str,
        base_url: str
    ) -> Dict[str, Any]:
        """Fetches live broker positions from Kotak Neo."""
        payload = {
            "edit_token": edit_token,
            "edit_sid": edit_sid,
            "base_url": base_url
        }
        return self._post_encrypted("positions", payload, timeout=10)

    def get_orders(
        self,
        edit_token: str,
        edit_sid: str,
        base_url: str,
        order_id: str = ""
    ) -> Dict[str, Any]:
        """Fetches live broker orderbook from Kotak Neo."""
        payload = {
            "edit_token": edit_token,
            "edit_sid": edit_sid,
            "base_url": base_url,
            "order_id": order_id
        }
        return self._post_encrypted("order_book", payload, timeout=10)
