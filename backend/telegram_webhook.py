import logging
from flask import Blueprint, request, jsonify
from .config import get_settings
from .telegram_bot import send_telegram_message

logger = logging.getLogger("epsa.telegram_webhook")
telegram_webhook_bp = Blueprint("telegram_webhook", __name__)
settings = get_settings()

@telegram_webhook_bp.route("/webhook", methods=["POST"])
def telegram_webhook():
    """
    Endpoint for Telegram to send updates to the bot.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"status": "ignored"}), 200

        # We only care about normal text messages for now
        if "message" in data and "text" in data["message"]:
            message = data["message"]
            chat_id = message["chat"]["id"]
            text = message["text"].strip()
            
            # Extract user's first name for a personalized greeting
            first_name = message.get("from", {}).get("first_name", "there")

            if text.startswith("/start"):
                # Handle /start command
                handle_start_command(chat_id, first_name)
            elif text.startswith("/help"):
                # Handle /help command
                handle_help_command(chat_id)
            else:
                # Optionally respond to unknown commands or ignore
                pass

        return jsonify({"status": "ok"}), 200
    except Exception as exc:
        logger.error(f"[Telegram Webhook] Error processing update: {exc}")
        # Always return 200 so Telegram doesn't retry the same failing update repeatedly
        return jsonify({"status": "error"}), 200

def handle_start_command(chat_id, first_name):
    """
    Sends a welcome message with a button to open the Mini App.
    We use the API directly via requests to send an inline keyboard.
    """
    bot_token = settings.telegram_bot_token
    if not bot_token:
        logger.error("[Telegram Webhook] No bot token configured.")
        return

    welcome_text = (
        f"👋 Welcome to EPSA, {first_name}!\n\n"
        "The Ethiopian Psychology Students' Association digital platform is now fully integrated with Telegram.\n\n"
        "Click the button below to launch the Mini App and access your dashboard."
    )
    
    # We construct the payload manually because the existing helper in telegram_bot.py 
    # doesn't support inline_keyboards yet.
    import requests
    import json
    
    # Use the official direct Mini App link
    app_url = settings.app_public_url
    if app_url.endswith("/"):
        app_url = app_url[:-1]
        
    reply_markup = {
        "inline_keyboard": [
            [
                {
                    "text": "🌟 Open EPSA Portal",
                    "web_app": {"url": app_url}
                }
            ]
        ]
    }
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": welcome_text,
        "reply_markup": json.dumps(reply_markup)
    }
    
    try:
        requests.post(url, data=payload, timeout=5)
    except Exception as e:
        logger.error(f"[Telegram Webhook] Failed to send /start reply: {e}")

def handle_help_command(chat_id):
    """
    Sends brief instructions to the user.
    """
    help_text = (
        "💡 *EPSA Bot Help*\n\n"
        "This bot provides secure access to the EPSA Student Portal.\n"
        "1. Send /start to open the Mini App.\n"
        "2. To link your account, log in to the portal and request a code. "
        "The bot will automatically send you your OTP."
    )
    # Use the simple helper since no buttons are needed
    send_telegram_message(chat_id, help_text, settings.telegram_bot_token)
