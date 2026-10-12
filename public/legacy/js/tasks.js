// Public task feed, task submission, likes/tips, and auditor actions.
async function saveConfirmedTaskToMongoDB({ taskTitle, link, transactionHash, chainTaskId, files, submitBtn }) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'SAVING TASK TO MONGODB...';
            const form = new FormData();
            form.append('taskTitle', taskTitle);
            form.append('proofLink', link);
            form.append('transactionHash', transactionHash);
            form.append('onChainTaskId', chainTaskId);
            files.slice(0, 5).forEach(file => form.append('attachments', file));
            const savedTask = await apiRequest('/api/tasks', { method: 'POST', body: form });
            await recordTxHistory('Task Submission', taskTitle, 'Confirmed on ' + ACTIVE_CHAIN_CONFIG.chainName, transactionHash);
            submitBtn.innerText = 'SUBMITTED ✓';
            submitBtn.className = 'btn-action completed';
            submitBtn.removeAttribute('aria-busy');
            submitBtn.disabled = true;
            const telegramStatus = savedTask.item?.telegramDeliveryStatus || 'unknown';
            const telegramError = savedTask.item?.telegramDeliveryError;
            if (telegramStatus === 'failed') {
                console.error('Task was saved, but Telegram channel delivery failed:', telegramError || 'No delivery details were provided.');
            }
            alert('Task confirmed on ' + ACTIVE_CHAIN_CONFIG.chainName + ' and saved to MongoDB.');
            await loadCommunityFeed();
        }

async function submitSpecificTask(taskId, taskTitle, threshold) {
            if (!userWalletAddress) return alert('Connect your wallet before submitting a task.');
            if (!userTelegramId) {
                try {
                    await ensureApiSession();
                    const profile = await apiRequest('/api/profile/me');
                    userTelegramId = profile.user?.telegramHandle || '';
                } catch (error) { console.warn('Profile lookup failed:', error.message); }
            }
            if (!userTelegramId) {
                alert('Please save your Telegram username or ID in the Dashboard first. It will be stored in your MongoDB profile.');
                window.openModal('dashboardModal');
                return;
            }
            const urlInput = document.getElementById('taskInput_' + taskId);
            const link = urlInput?.value.trim() || '';
            let parsedLink;
            try { parsedLink = new URL(link); } catch { return alert('Enter a valid proof URL starting with https:// or http://'); }
            if (!['http:', 'https:'].includes(parsedLink.protocol)) return alert('Proof link must use HTTPS or HTTP.');
            const fileInput = document.getElementById('taskFile_' + taskId);
            if (!fileInput?.files?.length) return alert('Please attach an image or video as task proof.');
            const submitBtn = document.getElementById('taskBtn_' + taskId);
            let confirmedTxHash = '';
            let chainTaskId = '';
            try {
                submitBtn.disabled = true;
                submitBtn.classList.add('button-busy');
                submitBtn.setAttribute('aria-busy', 'true');
                submitBtn.innerText = 'CHECKING DATABASE SESSION...';
                await ensureApiSession();
                if (!signer) throw new Error('Wallet signer is not ready. Reconnect your wallet.');
                if (!protocolContract) {
                    await assertProtocolDeployment(provider, GHM21_PROTOCOL_ADDRESS);
                    protocolContract = new ethers.Contract(GHM21_PROTOCOL_ADDRESS, PROTOCOL_ABI, signer);
                }
                try { chainTaskId = String(await protocolContract.getTaskSubmissionsCount()); } catch { chainTaskId = ''; }
                submitBtn.innerText = 'CONFIRM TASK ON POLYGON...';
                const txRequest = await protocolContract.submitTask.populateTransaction(taskTitle, link, { gasLimit: 300000n });
                const tx = await signer.sendTransaction(txRequest);
                confirmedTxHash = tx.hash;
                await tx.wait();
                // If the contract exposes a count, store the latest task index for later tips/auditor actions.
                try {
                    const afterCount = await protocolContract.getTaskSubmissionsCount();
                    if (afterCount > 0n) chainTaskId = String(afterCount - 1n);
                } catch { /* Keep the pre-transaction count if available. */ }
                await saveConfirmedTaskToMongoDB({
                    taskTitle,
                    link,
                    transactionHash: confirmedTxHash,
                    chainTaskId,
                    files: Array.from(fileInput.files),
                    submitBtn
                });
            } catch (err) {
                console.error('Task submission error:', err);
                if (confirmedTxHash) {
                    const retainedFiles = Array.from(fileInput?.files || []);
                    submitBtn.innerText = 'RETRY DATABASE SAVE';
                    submitBtn.disabled = false;
                    submitBtn.classList.remove('button-busy');
                    submitBtn.removeAttribute('aria-busy');
                    submitBtn.onclick = async (event) => {
                        event.preventDefault();
                        if (submitBtn.disabled) return;
                        submitBtn.disabled = true;
                        submitBtn.classList.add('button-busy');
                        submitBtn.setAttribute('aria-busy', 'true');
                        submitBtn.innerText = 'SAVING TASK TO MONGODB...';
                        try {
                            await ensureApiSession();
                            await saveConfirmedTaskToMongoDB({ taskTitle, link, transactionHash: confirmedTxHash, chainTaskId, files: retainedFiles, submitBtn });
                        } catch (retryError) {
                            submitBtn.innerText = 'RETRY DATABASE SAVE';
                            submitBtn.disabled = false;
                            submitBtn.classList.remove('button-busy');
                            submitBtn.removeAttribute('aria-busy');
                            console.error('MongoDB task-save retry failed; no new blockchain transaction was sent. Reuse the confirmed transaction hash:', { transactionHash: confirmedTxHash, error: retryError });
                        }
                    };
                    console.error('Blockchain task was confirmed, but saving to MongoDB failed. Use RETRY DATABASE SAVE; do not submit a new on-chain task:', { transactionHash: confirmedTxHash, error: err });
                } else {
                    submitBtn.disabled = false;
                    submitBtn.innerText = 'Submit Proof';
                    submitBtn.classList.remove('button-busy');
                    submitBtn.removeAttribute('aria-busy');
                }
            }
        }

async function loadCommunityFeed() {
            const feedContainer = document.getElementById('feedSubmissionsContainer');
            if (!feedContainer) return;
            feedContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 11px;">Loading shared MongoDB task feed...</p>';
            try {
                const result = await apiRequest('/api/tasks?limit=50&page=1');
                const submissions = result.items || [];
                if (!submissions.length) {
                    feedContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 11px;">No submissions in the public feed yet.</p>';
                    return;
                }
                const connectedWallet = (userWalletAddress || '').trim().toLowerCase();
                const configuredOperations = (OPERATIONS_WALLET_FALLBACK || '').trim().toLowerCase();
                let deployedAuditor = '';
                try {
                    if (protocolContract) deployedAuditor = (await protocolContract.auditorAddress()).trim().toLowerCase();
                } catch (error) {
                    console.warn('Could not read the deployed auditor wallet:', error);
                }
                const isAuditor = Boolean(connectedWallet && (connectedWallet === configuredOperations || connectedWallet === deployedAuditor));
                let html = '';
                submissions.forEach((sub) => {
                    const mongoId = String(sub.id || sub._id);
                    const performer = String(sub.performerWallet || sub.performer || '');
                    const maskedPerformer = performer.length > 12 ? performer.substring(0, 6) + '...' + performer.substring(performer.length - 4) : performer;
                    const title = escapeHtml(sub.taskTitle || 'Community task');
                    const proofLink = escapeHtml(sub.proofLink || '#');
                    const isVerified = Boolean(sub.isVerified);
                    const likes = Number(sub.likeCount || 0);
                    const tips = Number(sub.tipCount || 0);
                    let thresholdMax = 3;
                    if ((sub.taskTitle || '').includes('2')) thresholdMax = 5;
                    if ((sub.taskTitle || '').includes('3')) thresholdMax = 7;
                    if ((sub.taskTitle || '').includes('4')) thresholdMax = 10;
                    const chainTaskId = /^\d+$/.test(String(sub.onChainTaskId ?? '')) ? Number(sub.onChainTaskId) : -1;
                    let auditorButtons = '';
                    if (isAuditor && chainTaskId >= 0) {
                        auditorButtons = '<button class="btn-action" style="font-size:9px;padding:3px 8px;" onclick="withButtonBusy(this, () => auditorApproveTask(' + chainTaskId + ', \'' + mongoId + '\'), \'Approving…\')">APPROVE</button>' +
                            '<button class="btn-action" style="font-size:9px;padding:3px 8px;background:rgba(255,51,102,0.1);color:#ff3366;border-color:rgba(255,51,102,0.3);" onclick="withButtonBusy(this, () => auditorRejectTask(\'' + mongoId + '\', \'' + escapeHtml(performer) + '\', \'' + escapeHtml(sub.taskTitle || '') + '\'), \'Saving…\')">REJECT</button>';
                    }
                    const attachment = (sub.attachmentUrls || []).map((file, fileIndex) => '<div style="font-size:10px;margin-top:4px;"><a href="' + escapeHtml(apiBaseUrl() + file.url) + '" target="_blank" rel="noopener" style="color:var(--electric-cyan);">📎 View proof attachment ' + (fileIndex + 1) + ': ' + escapeHtml(file.filename || 'file') + '</a></div>').join('');
                    html += '<div class="feed-card" id="submission_' + mongoId + '" style="border-left:3px solid ' + (isVerified ? 'var(--neon-emerald)' : 'var(--electric-cyan)') + ';">' +
                        '<div class="modal-item-row"><span style="font-weight:700;color:var(--titanium-silver);">' + title + '</span>' +
                        '<span style="font-size:10px;color:var(--text-muted);">' + escapeHtml(maskedPerformer) + ' <button class="copy-btn" onclick="copyToClipboard(\'' + escapeHtml(performer) + '\')" style="padding:2px 4px;">Copy</button></span></div>' +
                        '<div style="font-size:11px;"><a href="' + proofLink + '" target="_blank" rel="noopener noreferrer" style="color:var(--electric-cyan);">🔗 Proof Link</a></div>' + attachment +
                        '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">' + escapeHtml(new Date(sub.createdAt).toLocaleString()) + ' · ' + (isVerified ? 'Verified' : 'Awaiting auditor') + '</div>' +
                        '<div class="modal-item-row" style="font-size:10px;color:var(--text-muted);"><span>Likes: <b id="likeCount_' + mongoId + '" style="color:var(--neon-emerald);">' + likes + '</b> | Tips: <b id="tipCount_' + mongoId + '" style="color:var(--neon-emerald);">' + tips + '/' + thresholdMax + '</b></span>' +
                        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
                        '<button class="btn-action cyan" style="font-size:9px;padding:3px 8px;" onclick="withButtonBusy(this, () => handleLike(\'' + mongoId + '\'), \'Saving…\')">' + (sub.likedByMe ? 'UNLIKE' : 'LIKE') + '</button>' +
                        (chainTaskId >= 0 ? '<button class="btn-action cyan" style="font-size:9px;padding:3px 8px;" onclick="withButtonBusy(this, () => handleTip(\'' + mongoId + '\',' + chainTaskId + ',' + thresholdMax + '), \'Sending tip…\')">$1 TIP</button>' : '') + auditorButtons +
                        '</div></div></div>';
                });
                feedContainer.innerHTML = html;
            } catch (err) {
                console.error('MongoDB task feed error:', err);
                feedContainer.innerHTML = '<p style="color:#ff3366;font-size:11px;">Could not load the shared database feed: ' + escapeHtml(err?.message || 'Unknown API error') + '. Check that the API is running and /api is proxied to port 4000.</p>';
            }
        }

async function recoverConfirmedTaskSubmission() {
            const hashInput = document.getElementById('recoverTaskHash');
            const fileInput = document.getElementById('recoverTaskFiles');
            const submitBtn = document.getElementById('recoverTaskButton');
            const transactionHash = hashInput?.value.trim() || '';
            if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) return alert('Paste the confirmed Polygon transaction hash first.');
            if (!userWalletAddress) return alert('Connect the wallet that sent this transaction before recovering it.');

            submitBtn.disabled = true;
            submitBtn.innerText = 'VERIFYING EXISTING TRANSACTION...';
            try {
                await ensureApiSession();
                const form = new FormData();
                form.append('transactionHash', transactionHash);
                Array.from(fileInput?.files || []).slice(0, 5).forEach(file => form.append('attachments', file));
                const result = await apiRequest('/api/tasks/recover', { method: 'POST', body: form });
                const task = result.item || {};
                await recordTxHistory('Task Submission', task.taskTitle || 'Recovered task', 'Confirmed on ' + ACTIVE_CHAIN_CONFIG.chainName, transactionHash);
                if (hashInput) hashInput.value = '';
                if (fileInput) fileInput.value = '';
                alert(result.alreadySaved ? 'This confirmed task was already saved to MongoDB.' : 'The existing on-chain task was verified and saved to MongoDB. No new blockchain transaction was sent.');
                await loadCommunityFeed();
            } catch (error) {
                console.error('Could not recover the existing confirmed task. Do not submit a new on-chain task:', { transactionHash, error });
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerText = 'Save confirmed task';
            }
        }

        async function handleLike(taskMongoId) {
            try {
                await ensureApiSession();
                await apiRequest('/api/tasks/' + encodeURIComponent(taskMongoId) + '/like', { method: 'POST', body: JSON.stringify({}) });
                await loadCommunityFeed();
            } catch (error) { console.error('Like could not be saved:', error); }
        }

        async function handleTip(taskMongoId, chainTaskId, thresholdMax) {
            if (!userWalletAddress) { await connectDynamicWallet(); if (!userWalletAddress) return; }
            try {
                const tipWei = ethers.parseEther("1.0");
                if (!usdtContract) usdtContract = new ethers.Contract(MOCK_USDT_ADDRESS, ERC20_ABI, signer);
                if (!protocolContract) protocolContract = new ethers.Contract(GHM21_PROTOCOL_ADDRESS, PROTOCOL_ABI, signer);
                
                const allowance = await usdtContract.allowance(userWalletAddress, GHM21_PROTOCOL_ADDRESS);
                if (allowance < tipWei) {
                    const approveTx = await usdtContract.approve(GHM21_PROTOCOL_ADDRESS, tipWei, { gasLimit: 100000n });
                    await approveTx.wait();
                }

                const txRequest = await protocolContract.tipTask.populateTransaction(chainTaskId, tipWei, { gasLimit: 300000n });
                const tx = await signer.sendTransaction(txRequest);
                await tx.wait();

                await ensureApiSession();
                await apiRequest('/api/tasks/' + encodeURIComponent(taskMongoId) + '/tip-record', { method: 'POST', body: JSON.stringify({ transactionHash: tx.hash }) });
                await recordTxHistory("Task Tip", "$1.00 USDT", "Confirmed on " + ACTIVE_CHAIN_CONFIG.chainName, tx.hash);
                await loadCommunityFeed();
                if (userTelegramId) {
                    await sendTelegramAlert(userTelegramId, "⚡ GHM21 Notification: Your $1 tip for Task #" + chainTaskId + " was confirmed on-chain!");
                }
                alert("⚡ $1 Tip successfully sent on-chain!");
            } catch(e) {
                console.error('Task tip failed:', e);
            }
        }

        async function auditorApproveTask(taskId, taskMongoId) {
            try {
                await ensureApiSession();
                if (!protocolContract && signer) protocolContract = new ethers.Contract(GHM21_PROTOCOL_ADDRESS, PROTOCOL_ABI, signer);
                const txReq = await protocolContract.verifyTask.populateTransaction(taskId, { gasLimit: 300000n });
                const tx = await signer.sendTransaction(txReq);
                await tx.wait();
                if (taskMongoId) await apiRequest('/api/tasks/' + encodeURIComponent(taskMongoId.trim()) + '/verify-record', { method: 'POST', body: JSON.stringify({ transactionHash: tx.hash }) });
                await recordTxHistory('Task Approval', 'Task #' + taskId, 'Confirmed on ' + ACTIVE_CHAIN_CONFIG.chainName, tx.hash);
                alert('Task successfully approved on ' + ACTIVE_CHAIN_CONFIG.chainName + ' and updated in MongoDB.');
                await loadCommunityFeed();
            } catch(e) {
                console.error('Task approval failed:', e);
            }
        }

        async function auditorRejectTask(taskMongoId, performerAddress, taskTitle) {
            const reason = prompt('Enter mandatory short note/comment for task rejection:');
            if (!reason) return;
            try {
                await ensureApiSession();
                await apiRequest('/api/tasks/' + encodeURIComponent(taskMongoId) + '/reject', { method: 'POST', body: JSON.stringify({ reason }) });
                alert('Rejection note saved to MongoDB.');
                await loadCommunityFeed();
            } catch (error) {
                console.error('Task rejection was not saved:', error);
            }
        }
