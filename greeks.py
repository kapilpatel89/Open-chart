"""
Black-Scholes European Option Pricing & Greeks Calculator for Indian Indices & Stocks.
Calculates Theoretical Price, Delta, Gamma, Theta, Vega, and Implied Volatility (IV).
"""

import math
from typing import Dict, Any, Optional, List, Tuple

def norm_cdf(x: float) -> float:
    """Cumulative standard normal distribution function."""
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0

def norm_pdf(x: float) -> float:
    """Probability density function of standard normal distribution."""
    return (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * x * x)

def calculate_greeks(
    spot: float,
    strike: float,
    days_to_expiry: float = 4.0,
    iv: float = 0.15,
    r: float = 0.07,  # Indian RBI Repo risk-free rate ~ 7%
    option_type: str = "CE",
    dte: Optional[float] = None
) -> Dict[str, Any]:
    """
    Computes Black-Scholes theoretical price and Greeks (Delta, Gamma, Theta, Vega)
    for Indian index & equity option contracts.
    """
    if dte is not None:
        days_to_expiry = dte

    if option_type.upper() in ["BOTH", "PAIR", "ALL"]:
        ce = calculate_greeks(spot, strike, days_to_expiry, iv, r, "CE")
        pe = calculate_greeks(spot, strike, days_to_expiry, iv, r, "PE")
        return {
            "ce": ce,
            "pe": pe,
            "call": ce,
            "put": pe
        }

    t = max(days_to_expiry, 0.001) / 365.0
    sigma = max(iv, 0.01)

    d1 = (math.log(spot / strike) + (r + 0.5 * sigma * sigma) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)

    pdf_d1 = norm_pdf(d1)
    cdf_d1 = norm_cdf(d1)
    cdf_d2 = norm_cdf(d2)

    is_call = option_type.upper() in ["CE", "CALL"]

    if is_call:
        price = spot * cdf_d1 - strike * math.exp(-r * t) * cdf_d2
        delta = cdf_d1
        theta = (- (spot * pdf_d1 * sigma) / (2 * math.sqrt(t))
                 - r * strike * math.exp(-r * t) * cdf_d2) / 365.0
    else:
        cdf_neg_d1 = norm_cdf(-d1)
        cdf_neg_d2 = norm_cdf(-d2)
        price = strike * math.exp(-r * t) * cdf_neg_d2 - spot * cdf_neg_d1
        delta = -cdf_neg_d1
        theta = (- (spot * pdf_d1 * sigma) / (2 * math.sqrt(t))
                 + r * strike * math.exp(-r * t) * cdf_neg_d2) / 365.0

    gamma = pdf_d1 / (spot * sigma * math.sqrt(t))
    vega = (spot * math.sqrt(t) * pdf_d1) / 100.0  # Per 1% change in IV
    final_price = max(0.05, round(price, 2))

    return {
        "price": final_price,
        "theoretical_price": final_price,
        "delta": round(delta, 3),
        "gamma": round(gamma, 5),
        "theta": round(theta, 2),
        "vega": round(vega, 2),
        "iv": round(sigma * 100, 1)
    }

def estimate_iv(
    spot: float,
    strike: float,
    days_to_expiry: float,
    market_price: float,
    option_type: str = "CE",
    r: float = 0.07
) -> float:
    """Bisection algorithm to extract implied volatility from market price."""
    low_iv = 0.01
    high_iv = 3.0
    for _ in range(25):
        mid_iv = (low_iv + high_iv) / 2.0
        g = calculate_greeks(spot, strike, days_to_expiry, mid_iv, r, option_type)
        p = g["theoretical_price"]
        if abs(p - market_price) < 0.1:
            return round(mid_iv * 100, 1)
        if p < market_price:
            low_iv = mid_iv
        else:
            high_iv = mid_iv
    return round(mid_iv * 100, 1)
