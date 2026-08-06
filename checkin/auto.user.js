// ==UserScript==
// @name         衛生報告入力自動化ツール
// @namespace    https://github.com/manjuu08/scripts
// @version      2.3
// @description  衛生報告入力の自動化ツール。確認者IDの自動抽出・選択機能に加え、体温自動入力や個人ID設定により、日々の報告業務を効率化します。
// @author       manjuu08
// @match        https://app.hisol-work.net/*
// @icon  　　　　https://free-icons.net/wp-content/uploads/2020/10/symbol033.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @homepage    https://github.com/manjuu08/checkin
// @supportURL  https://github.com/manjuu08/checkin/issues
// @license      MIT
// @updateURL   https://github.com/manjuu08/scripts/raw/main/checkin/auto.user.js
// @downloadURL https://github.com/manjuu08/scripts/raw/main/checkin/auto.user.js
// ==/UserScript==
(function() {
    'use strict';

    // --- ID 管理配置（出勤者IDのみ） ---
    GM_registerMenuCommand("⚙️ 出勤者IDを設定", () => {
        showIdInputPopup(GM_getValue('target_user_id', ''), (id) => {
            GM_setValue('target_user_id', id);
            if (id === '') {
                alert("出勤者IDを削除しました");
            }
        });
    });
    GM_registerMenuCommand("🗑️ 全ての設定を削除", () => {
        GM_setValue('target_user_id', '');
        alert("設定を削除しました");
    });

    // --- 主逻辑 ---
    // DOM が変動するたびに即座にチェックし、ボタン未注入なら注入。
    // setInterval 轮询と違い、SPA の DOM 到着とほぼ同時に反応できる。
    function tryInject() {
        // 1) 「体温」行をリスト先頭に移動
        moveTemperatureRowToTop();

        const btnContainer = document.querySelector('input[placeholder="出勤者名選択"]')?.parentElement?.parentElement;
        if (btnContainer && !document.getElementById('inject-all-btn')) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:relative; margin-top:10px; background:#5EA500; border-radius:4px;';
            const btn = document.createElement('button');
            btn.id = 'inject-all-btn';
            btn.innerText = '✅ 一括全自動入力';
            btn.style.cssText = 'padding:10px 16px; background:transparent; color:white; border:none; border-radius:4px; cursor:pointer; width:100%; font-weight:bold;';
            const credit = document.createElement('span');
            credit.innerText = 'by ショウ';
            credit.style.cssText = 'position:absolute; bottom:3px; right:6px; font-size:10px; color:rgba(255,255,255,0.7);';
            wrapper.appendChild(btn);
            wrapper.appendChild(credit);
            btn.onclick = async () => {
              try {
                // 1. チェックを入れる
                document.querySelectorAll('img').forEach(img => {
                    if (img.src && img.src.includes('%235EA500')) {
                        (img.closest('button') || img.parentElement)?.click();
                    }
                });
                // 2. 体温をランダム生成
                const temp = (36.0 + Math.random() * 0.5).toFixed(1);
                const tempInput = document.querySelector('input.w-full.h-full.pr-7.text-center.font-bold.rounded-md.border.border-gray-200');
                if (tempInput) {
                    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(tempInput, temp);
                    tempInput.dispatchEvent(new Event('input', { bubbles: true }));
                    tempInput.dispatchEvent(new Event('change', { bubbles: true }));
                    tempInput.dispatchEvent(new Event('blur', { bubbles: true }));
                }
                // 3. 出勤者IDを自動選択
                await selectID("出勤者名選択", GM_getValue('target_user_id', ''));

                // 4. 確認者は自動スキャン→ポップアップで手動選択
                // （出勤者側のリスト残りは scanOptions 側で Set 去重 +
                //   offsetParent 可视性过滤で吸収するため、
                //   Escape 派发による親モーダル閉鎖リスクを避ける）
                autoScanAndShowPopup();
              } catch (err) {
                console.error('[衛生報告自動化] エラー発生:', err);
                alert("自動入力中にエラーが発生しました。ページを再読み込みして再試行してください。\n詳細: " + (err && err.message ? err.message : err));
              }
            };
            btnContainer.appendChild(wrapper);
        }
    }

    // 初回は即時実行（既に DOM が揃っている場合の即応）
    tryInject();

    // 以降は DOM 変動ごとに即座に反応（setInterval不要）
    // 高頻度発火を防ぐため requestAnimationFrame で1フレームに1回に間引く。
    // tryInject はボタン未注入時のみ追加するので無限ループしない。
    let scheduled = false;
    const mo = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            tryInject();
        });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // --- 「体温」行をリスト先頭に移動 ---
    // 体温行は input[type="number"] を含み、かつ隣に「℃」表示がある行。
    // その行を親リストの先頭に挿入する。既に先頭なら何もしない。
    function moveTemperatureRowToTop() {
        const tempInput = document.querySelector('input[type="number"][step="0.1"]');
        if (!tempInput) return;

        // 体温行 = tempInput を含む直接の子div（リスト項目）
        let row = tempInput.parentElement; // relative div
        while (row && row.parentElement) {
            const parent = row.parentElement;
            // リスト項目の特徴：py-2 px-4 を持つ div
            if (parent.classList.contains('divide-y') || /divide-y/.test(parent.className)) {
                // row はまだ relative wrapper の可能性 → リスト項目まで遡る
                let item = row;
                while (item && item.parentElement !== parent) {
                    item = item.parentElement;
                }
                if (!item) return;
                if (item === parent.firstElementChild) return; // 既に先頭
                parent.insertBefore(item, parent.firstChild);
                return;
            }
            row = parent;
        }
    }

    async function selectID(placeholder, id) {
        if (!id) return;
        const input = document.querySelector(`input[placeholder="${placeholder}"]`);
        if (!input) return;
        input.click();
        await new Promise(r => setTimeout(r, 600));

        const options = document.querySelectorAll('li[role="option"]');
        for (let li of options) {
            if (li.textContent.includes(id)) {
                li.click();
                break;
            }
        }
    }

    // --- ドロップダウンを閉じるヘルパ（現状は未使用） ---
    // Escape 派発が親モーダルごと閉じてしまうリスクがあるため使用禁止。
    // 代わりに scanOptions 側の Set 去重 + offsetParent フィルタで重複を防ぐ。
    function closeAllDropdowns() {
        const inputs = document.querySelectorAll('input[placeholder$="名選択"]');
        inputs.forEach(input => input.blur());
        return new Promise(r => setTimeout(r, 200));
    }

    // --- 設定用：ページ内入力ポップアップ（ブラウザのprompt()の代替） ---
    function showIdInputPopup(currentValue, onConfirm) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10001; display:flex; justify-content:center; align-items:center;';

        const box = document.createElement('div');
        box.style.cssText = 'background:white; padding:20px; border-radius:8px; min-width:300px;';
        box.innerHTML = `
            <h3 style="margin-top:0; border-bottom:1px solid #ccc; padding-bottom:10px;">出勤者IDを設定</h3>
            <p style="font-size:13px; color:#666; margin:4px 0 10px;">空欄で保存すると削除扱いになります</p>
            <input id="id-input-field" type="text" style="width:100%; box-sizing:border-box; padding:8px; font-size:14px; border:1px solid #ccc; border-radius:4px;" />
            <div style="display:flex; gap:8px; margin-top:16px;">
                <button id="id-input-cancel" style="flex:1; padding:10px; cursor:pointer; background:#f0f0f0; border:1px solid #ddd; border-radius:4px;">キャンセル</button>
                <button id="id-input-save" style="flex:1; padding:10px; cursor:pointer; background:#5EA500; color:white; border:none; border-radius:4px; font-weight:bold;">保存</button>
            </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const field = box.querySelector('#id-input-field');
        field.value = currentValue;
        field.focus();

        const close = () => document.body.removeChild(overlay);

        box.querySelector('#id-input-cancel').onclick = close;

        const save = () => {
            const id = field.value.trim();
            close();
            onConfirm(id);
        };
        box.querySelector('#id-input-save').onclick = save;

        field.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') close();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    }

    // --- 確認者：自動スキャンロジック（033始まりのIDを抽出） ---
    function autoScanAndShowPopup() {
        const approverInput = document.querySelector('input[placeholder="確認者名選択"]');
        if (!approverInput) return;

        // 確認者ドロップダウンを開く前に、既存の li[role="option"] 数を記録。
        // 出勤者側リストが残っていた場合、その数だけ先頭から除外することで
        // 確認者側の li だけを拾う（同IDの重複も出勤者側の別ID混入も防げる）。
        const baselineCount = document.querySelectorAll('li[role="option"]').length;

        approverInput.click();

        const maxAttempts = 10;          // 最大試行回数
        const interval = 300;            // 1回あたり300ms → 合計タイムアウト3000ms
        let attempts = 0;
        let foundUsers = null;

        const scanOptions = () => {
            const users = [];
            const seenIds = new Set();
            const allOptions = document.querySelectorAll('li[role="option"]');
            // 先頭 baselineCount 個は確認者リスト以外の可能性があるためスキップ
            for (let i = baselineCount; i < allOptions.length; i++) {
                const li = allOptions[i];
                // 非表示の li はスキップ（offsetParent が null = 非表示）
                if (!li.offsetParent) continue;

                const text = li.textContent.trim();

                // ✅ 033で始まるIDのみを厳密にマッチ（前に他の数字が連なっていないこと）
                const match = text.match(/(?<!\d)033\d+/);

                if (match) {
                    const id = match[0];
                    // 同じ社員IDが複数リストから拾われるのを防ぐ
                    if (seenIds.has(id)) continue;
                    seenIds.add(id);
                    users.push({ name: text.replace(id, "").trim(), id: id });
                }
            }
            return users;
        };

        const tick = () => {
            attempts++;
            foundUsers = scanOptions();
            if (foundUsers.length > 0) {
                showApproverPopup(foundUsers);
            } else if (attempts < maxAttempts) {
                setTimeout(tick, interval);
            } else {
                alert("033から始まる社員IDが見つかりませんでした（読み込み待ちの可能性あり）。ドロップダウンが展開されているか確認してください。");
            }
        };

        setTimeout(tick, interval);
    }

    // --- 確認者：動的ポップアップ表示ロジック ---
    function showApproverPopup(users) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; display:flex; justify-content:center; align-items:center;';

        const box = document.createElement('div');
        box.style.cssText = 'background:white; padding:20px; border-radius:8px; min-width:300px; max-height:80vh; overflow-y:auto;';
        box.innerHTML = '<h3 style="margin-top:0; border-bottom:1px solid #ccc; padding-bottom:10px;">確認者を選択してください:</h3>';

        users.forEach(p => {
            const nBtn = document.createElement('button');
            nBtn.innerHTML = `<strong>${p.name}</strong> <span style="color:#666;">(ID: ${p.id})</span>`;
            nBtn.style.cssText = 'display:block; width:100%; margin:8px 0; padding:10px; cursor:pointer; background:#f9f9f9; border:1px solid #ddd; border-radius:4px; text-align:left;';
            nBtn.onclick = () => {
                selectApproverById(p.id);
                document.body.removeChild(overlay);
            };
            box.appendChild(nBtn);
        });

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const close = () => document.body.removeChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        document.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', onKey);
            }
        });
    }

    // --- 確認者：指定IDを選択 ---
    function selectApproverById(targetId) {
        const approverInput = document.querySelector('input[placeholder="確認者名選択"]');
        if (approverInput) {
            approverInput.click();
            setTimeout(() => {
                const options = document.querySelectorAll('li[role="option"]');
                for (let i = 0; i < options.length; i++) {
                    if (options[i].textContent.includes(targetId)) {
                        options[i].click();
                        break;   // 1つだけクリック
                    }
                }
            }, 500);
        }
    }
})();
