// User profile persistence (Telegram handle/ID) via MongoDB API.
async function saveTelegramId() {
            const val = document.getElementById('telegramIdInput').value.trim();
            if (!val) return alert("Please enter your Telegram username or ID.");
            if (!userWalletAddress) return alert("Please connect your Web3 wallet first.");
            try {
                await ensureApiSession();
                await apiRequest('/api/profile/me', { method: 'PUT', body: JSON.stringify({ telegramHandle: val }) });
                userTelegramId = val;
                alert("Telegram name/ID saved to your MongoDB profile.");
                await sendTelegramAlert(val, "GHM21: Your Telegram name/ID has been saved for wallet " + userWalletAddress + ".");
            } catch (error) {
                console.error('Could not save Telegram details to the database:', error);
            }
        }
