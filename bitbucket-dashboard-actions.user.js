// ==UserScript==
// @name         Bitbucket Dashboard PR Actions
// @namespace    https://github.com/Robin479/browser-tweaks
// @version      1.0.2
// @description  Adds an "Actions" column (needs work / approve / merge / decline) to the open PR lists on the Bitbucket dashboard
// @author       Kai Kunstmann
// @homepageURL  https://github.com/Robin479/browser-tweaks
// @license      Apache-2.0
// @updateURL    https://raw.githubusercontent.com/Robin479/browser-tweaks/main/bitbucket-dashboard-actions.user.js
// @downloadURL  https://raw.githubusercontent.com/Robin479/browser-tweaks/main/bitbucket-dashboard-actions.user.js
// @include      /^https:\/\/bitbucket\.[^\/]+\/dashboard/
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    
    const PR_HREF = /\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/;
    const MAX_PARALLEL_LOADS = 4;
    // How long the action buttons stay disabled after Bitbucket re-renders or reorders the PR rows.
    const REORDER_GUARD_MS = 1000;
    // "Recently closed pull requests" (.closed-pull-requests) gets no actions.
    const OPEN_PR_ROWS = ['reviewing-pull-requests', 'created-pull-requests']
        .map(section => `.dashboard-pull-request-table.${section} tbody tr.pull-request-row`)
        .join(', ');
    const CELL_CLASS = 'tm-pr-actions';
    const HEADER_CLASS = 'tm-pr-actions-header';
    
    // UI texts, chosen by the language Bitbucket renders the page in (<html lang>); English otherwise.
    // German terms follow Bitbucket's own German UI ("Pull-Anfrage", "Mergen", "Ablehnen", "genehmigt").
    const TEXTS = {
        en: {
            actions: 'Actions',
            needsWork: 'Request changes: This pull request shouldn\'t be merged yet',
            approve: 'Approve: This pull request is ready to merge',
            decline: 'Decline: Close this pull request without merging',
            merge: 'Merge',
            repositoryDefault: 'repository default',
            mergeSummary: (strategy, deleteSourceBranch) => `Strategy: ${strategy}\nSource branch: ${deleteSourceBranch ? 'delete' : 'keep'}`,
            mergeQuestion: (id, title) => `Merge pull request #${id} "${title}"?`,
            mergeConflicts: 'Merge conflicts',
            notMergeable: 'Not mergeable',
            vetoes: count => (count === 1 ? '1 merge blocking issue' : `${count} merge blocking issues`),
            cannotMerge: (id, repo) => `Pull request #${id} (${repo}) cannot be merged:`,
            declineQuestion: (id, title) => `Decline pull request #${id} "${title}"?\n\nThis closes the pull request for everyone.`,
            declineConfirm: (id, repo) => `Are you sure?\n\nPull request #${id} in ${repo} will be declined.`,
            states: { MERGED: 'merged', DECLINED: 'declined' },
        },
        de: {
            actions: 'Aktionen',
            needsWork: 'Änderungen anfordern: Für diese Pull-Anfrage sollte noch kein Merge durchgeführt werden',
            approve: 'Genehmigen: Diese Pull-Anfrage kann nun zusammengeführt werden',
            decline: 'Ablehnen: Diese Pull-Anfrage ohne Mergen schließen',
            merge: 'Mergen',
            repositoryDefault: 'Repository-Standard',
            mergeSummary: (strategy, deleteSourceBranch) => `Merge-Strategie: ${strategy}\nQuell-Branch: ${deleteSourceBranch ? 'nach Mergen löschen' : 'behalten'}`,
            mergeQuestion: (id, title) => `Pull-Anfrage #${id} "${title}" mergen?`,
            mergeConflicts: 'Merge-Konflikte',
            notMergeable: 'Kann nicht gemergt werden',
            vetoes: count => (count === 1 ? '1 Vorgang, der den Merge verhindert' : `${count} Vorgänge, die den Merge verhindern`),
            cannotMerge: (id, repo) => `Pull-Anfrage #${id} (${repo}) kann nicht gemergt werden:`,
            declineQuestion: (id, title) => `Pull-Anfrage #${id} "${title}" ablehnen?\n\nDamit wird die Pull-Anfrage für alle geschlossen.`,
            declineConfirm: (id, repo) => `Sind Sie sicher?\n\nPull-Anfrage #${id} in ${repo} wird abgelehnt.`,
            states: { MERGED: 'gemergt', DECLINED: 'abgelehnt' },
        },
    };
    const T = TEXTS[document.documentElement.lang.split('-')[0]] ?? TEXTS.en;
    
    const remoteUser = document.querySelector('meta[name="ajs-remote-user"]')?.content;
    const repoCache = new Map();
    
    // ---------------------------------------------------------------- REST
    
    async function request(method, path, body) {
        const response = await fetch(path, {
            method,
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-Atlassian-Token': 'no-check',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        const json = text ? JSON.parse(text) : null;
        if (response.ok) {
            return json;
        }
        const message = json?.errors?.map(e => e.message).join('\n') || `${response.status} ${response.statusText}`;
        throw new Error(message);
    }
    
    function prPath(pr) {
        return `/rest/api/latest/projects/${pr.project}/repos/${pr.repo}/pull-requests/${pr.id}`;
    }
    
    function repoKey(pr) {
        return `${pr.project}/${pr.repo}`;
    }
    
    /** Per-repo merge settings, loaded once: default strategy name and the remembered "delete source branch" choice. */
    function loadRepoSettings(pr) {
        const key = repoKey(pr);
        const cached = repoCache.get(key);
        if (cached) {
            return cached;
        }
        const repoBase = `/projects/${pr.project}/repos/${pr.repo}`;
        const settings = Promise.all([
            request('GET', `/rest/api/latest${repoBase}/settings/pull-requests`),
            request('GET', `/rest/branch-utils/latest${repoBase}/delete-after-merge`).catch(() => ({ enabled: false })),
        ]).then(([prSettings, deleteAfterMerge]) => ({
            strategyName: prSettings?.mergeConfig?.defaultStrategy?.name ?? T.repositoryDefault,
            deleteSourceBranch: deleteAfterMerge?.enabled === true,
        }));
        repoCache.set(key, settings);
        return settings;
    }
    
    async function loadState(pr) {
        const [details, mergeStatus] = await Promise.all([
            request('GET', prPath(pr)),
            request('GET', `${prPath(pr)}/merge`).catch(e => ({ canMerge: false, vetoes: [{ summaryMessage: e.message }] })),
        ]);
        const me = [details.author, ...details.reviewers, ...details.participants]
            .find(p => p.user.name === remoteUser);
        return { details, mergeStatus, me };
    }
    
    function setStatus(pr, state, status) {
        const slug = state.me?.user.slug ?? remoteUser;
        return request('PUT', `${prPath(pr)}/participants/${encodeURIComponent(slug)}?version=${state.details.version}`, {
            status,
            lastReviewedCommit: state.details.fromRef.latestCommit,
        });
    }
    
    function decline(pr, state) {
        return request('POST', `${prPath(pr)}/decline?version=${state.details.version}`, {});
    }
    
    async function merge(pr, state, settings) {
        const suggestion = await request('GET', `${prPath(pr)}/commit-message-suggestion`);
        // Same body as the merge dialog; no strategyId means the repository's default strategy.
        await request('POST', `${prPath(pr)}/merge?version=${state.details.version}`, {
            autoSubject: false,
            message: `${suggestion.title}\n\n${suggestion.body}`,
            autoMerge: false,
            bypassMergeQueue: false,
        });
        if (settings.deleteSourceBranch) {
            await request('POST', `/rest/pull-request-cleanup/latest/projects/${pr.project}/repos/${pr.repo}/pull-requests/${pr.id}`, {
                deleteSourceRef: true,
                retargetDependents: true,
            });
        }
    }
    
    // ---------------------------------------------------------------- load queue
    
    const queue = [];
    let running = 0;
    
    function enqueue(task) {
        return new Promise((resolve, reject) => {
            queue.push(() => task().then(resolve, reject));
            pump();
        });
    }
    
    function pump() {
        while (running < MAX_PARALLEL_LOADS && 0 < queue.length) {
            running++;
            queue.shift()().finally(() => {
                running--;
                pump();
            });
        }
    }
    
    // ---------------------------------------------------------------- UI
    
    // Same warning triangle the PR page shows on its merge-vetoes button.
    const WARNING_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" role="presentation"><path fill="currentcolor" fill-rule="evenodd" d="m13.31 5.343 7.359 13.17A1 1 0 0 1 19.796 20H4.204a1 1 0 0 1-.873-1.488l7.36-13.169a1.5 1.5 0 0 1 2.618 0M12 8.5a1.09 1.09 0 0 0-1.081 1.239l.513 3.766a.573.573 0 0 0 1.136 0l.513-3.766A1.09 1.09 0 0 0 12 8.5m0 8.63a1.125 1.125 0 1 0 0-2.25 1.125 1.125 0 0 0 0 2.25"></path></svg>';
    
    function button(classes, label, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `tm-button ${classes}`;
        b.setAttribute('aria-label', label);
        b.title = label;
        b.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (isGuarded()) {
                return;
            }
            onClick();
        });
        return b;
    }
    
    function iconButton(classes, icon, selected, label, onClick) {
        const b = button(selected ? `${classes} selected` : classes, label, onClick);
        const span = document.createElement('span');
        span.className = selected
            ? `aui-icon aui-icon-small aui-iconfont-${icon} inverse`
            : `aui-icon aui-icon-small aui-iconfont-${icon}`;
        b.append(span);
        return b;
    }
    
    function message(cell, text, title) {
        cell.replaceChildren();
        const span = document.createElement('span');
        span.textContent = text;
        span.title = title ?? '';
        span.className = 'tm-message';
        cell.append(span);
    }
    
    async function run(cell, pr, action) {
        cell.querySelectorAll('button').forEach(b => b.disabled = true);
        try {
            await action();
        } catch (e) {
            alert(`#${pr.id} (${repoKey(pr)}): ${e.message}`);
        }
        await render(cell, pr);
    }
    
    function vetoText(mergeStatus) {
        const vetoes = mergeStatus.vetoes ?? [];
        return vetoes.length === 0
            ? (mergeStatus.conflicted ? T.mergeConflicts : T.notMergeable)
            : vetoes.map(v => v.summaryMessage).join('\n');
    }
    
    /** Invisible stand-in for the vetoes button, so the Merge buttons line up across rows. */
    function vetoesPlaceholder() {
        const span = document.createElement('span');
        span.className = 'tm-button tm-vetoes tm-hidden';
        span.setAttribute('aria-hidden', 'true');
        span.innerHTML = `${WARNING_SVG}<span class="tm-veto-count">0</span>`;
        return span;
    }
    
    function vetoesButton(pr, mergeStatus) {
        const text = vetoText(mergeStatus);
        const count = Math.max(mergeStatus.vetoes?.length ?? 0, 1);
        const b = button('tm-vetoes', `${T.vetoes(count)}:\n${text}`, () => alert(`${T.cannotMerge(pr.id, repoKey(pr))}\n\n${text}`));
        b.innerHTML = `${WARNING_SVG}<span class="tm-veto-count">${count}</span>`;
        return b;
    }
    
    function mergeButtons(cell, pr, state, settings) {
        const mergeStatus = state.mergeStatus;
        const summary = T.mergeSummary(settings.strategyName, settings.deleteSourceBranch);
        const mergeButton = button('tm-merge', `${T.merge}\n\n${summary}`, () => {
            const question = `${T.mergeQuestion(pr.id, state.details.title)}\n`
                + `${state.details.fromRef.displayId} → ${state.details.toRef.displayId}\n\n${summary}`;
            if (confirm(question)) {
                run(cell, pr, () => merge(pr, state, settings));
            }
        });
        mergeButton.textContent = T.merge;
        if (mergeStatus.canMerge) {
            return [vetoesPlaceholder(), mergeButton];
        }
        mergeButton.disabled = true;
        return [vetoesButton(pr, mergeStatus), mergeButton];
    }
    
    function statusButtons(cell, pr, state) {
        const myStatus = state.me?.status;
        const toggle = status => () => run(cell, pr, () => setStatus(pr, state, myStatus === status ? 'UNAPPROVED' : status));
        const group = document.createElement('div');
        group.className = 'tm-status-buttons';
        group.append(
            iconButton('tm-needs-work', 'needs-work', myStatus === 'NEEDS_WORK',
                T.needsWork, toggle('NEEDS_WORK')),
            iconButton('tm-approve', 'approve', myStatus === 'APPROVED',
                T.approve, toggle('APPROVED')));
        if (state.me?.role === 'AUTHOR') {
            // Like on the PR page, authors get no review buttons; keep the space so the columns line up.
            group.classList.add('tm-hidden');
        }
        return group;
    }
    
    function declineButton(cell, pr, state) {
        return iconButton('tm-decline', 'remove', false, T.decline, () => {
            const confirmed = confirm(T.declineQuestion(pr.id, state.details.title))
                && confirm(T.declineConfirm(pr.id, repoKey(pr)));
            if (confirmed) {
                run(cell, pr, () => decline(pr, state));
            }
        });
    }
    
    async function render(cell, pr) {
        message(cell, '…');
        try {
            const [state, settings] = await enqueue(() => Promise.all([loadState(pr), loadRepoSettings(pr)]));
            if (state.details.state !== 'OPEN') {
                message(cell, T.states[state.details.state] ?? state.details.state.toLowerCase());
                return;
            }
            const container = document.createElement('div');
            container.className = 'tm-buttons';
            container.append(
                statusButtons(cell, pr, state),
                ...mergeButtons(cell, pr, state, settings),
                declineButton(cell, pr, state));
            cell.replaceChildren(container);
        } catch (e) {
            message(cell, '⚠', e.message);
        }
    }

    // ---------------------------------------------------------------- DOM wiring
    
    // Bitbucket occasionally reloads the lists and re-sorts them (e.g. by review status), moving rows
    // under the cursor. Ignore clicks briefly afterwards so a click cannot hit a different PR.
    let guardedUntil = 0;
    let guardTimer;
    
    function isGuarded() {
        return performance.now() < guardedUntil;
    }
    
    function guard() {
        guardedUntil = performance.now() + REORDER_GUARD_MS;
        document.documentElement.classList.add('tm-guarded');
        clearTimeout(guardTimer);
        guardTimer = setTimeout(() => document.documentElement.classList.remove('tm-guarded'), REORDER_GUARD_MS);
    }
    
    function containsPrRow(node) {
        return node instanceof Element && (node.matches('tr.pull-request-row') || node.querySelector('tr.pull-request-row') !== null);
    }
    
    /** Rows being removed (a move is a removal plus an insertion) mean the list was re-rendered. */
    function isRowRemoval(record) {
        return [...record.removedNodes].some(containsPrRow);
    }
    
    function onMutations(records) {
        if (records.some(isRowRemoval)) {
            guard();
        }
        scheduleScan();
    }
    
    function addHeader(table) {
        const headerRow = table.querySelector('thead tr');
        if (headerRow === null || headerRow.querySelector(`.${HEADER_CLASS}`)) {
            return;
        }
        const th = document.createElement('th');
        th.className = HEADER_CLASS;
        th.textContent = T.actions;
        headerRow.append(th);
    }
    
    function processRow(row, anchor) {
        const [, project, repo, id] = anchor.pathname.match(PR_HREF);
        const pr = { project, repo, id };
        const key = `${repoKey(pr)}#${id}`;
        const existing = row.querySelector(`:scope > .${CELL_CLASS}`);
        if (existing?.dataset.pr === key) {
            return;
        }
        if (existing) {
            // The row was reused for another PR: its buttons would act on the wrong one.
            existing.remove();
            guard();
        }
        const cell = document.createElement('td');
        cell.className = CELL_CLASS;
        cell.dataset.pr = key;
        row.append(cell);
        addHeader(row.closest('table'));
        render(cell, pr);
    }
    
    function scan() {
        for (const row of document.querySelectorAll(OPEN_PR_ROWS)) {
            const anchor = row.querySelector('.summary-column .title a');
            if (anchor && PR_HREF.test(anchor.pathname)) {
                processRow(row, anchor);
            }
        }
    }
    
    // Mirrors the PR page: Atlaskit default buttons (their CSS is generated at runtime, so it is
    // re-created here from the design tokens) plus Bitbucket's .reviewer-status-buttons rules.
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .${CELL_CLASS} { white-space: nowrap; vertical-align: middle; }
            .${CELL_CLASS} .tm-message { color: var(--ds-text-subtlest, #626f86); }
            .${CELL_CLASS} .tm-buttons { display: flex; align-items: center; gap: 8px; }
            .${CELL_CLASS} .tm-button {
                display: inline-flex; align-items: center; justify-content: center;
                box-sizing: border-box; height: 32px; padding: 0 10px; border: none;
                border-radius: var(--ds-border-radius, 3px);
                background: var(--ds-background-neutral, #091e420f);
                color: var(--ds-text-subtle, #44546f);
                font: inherit; font-weight: var(--ds-font-weight-medium, 500);
                cursor: pointer; white-space: nowrap;
                transition: background 0.1s ease-out;
            }
            .${CELL_CLASS} .tm-button:hover { background: var(--ds-background-neutral-hovered, #091e4224); }
            .${CELL_CLASS} .tm-button:active { background: var(--ds-background-neutral-pressed, #091e424f); }
            .${CELL_CLASS} .tm-button:focus-visible { outline: 2px solid var(--ds-border-focused, #388bff); outline-offset: 2px; }
            .${CELL_CLASS} .tm-button:disabled {
                background: var(--ds-background-disabled, #091e4208);
                color: var(--ds-text-disabled, #091e424f);
                cursor: not-allowed;
            }
            .${CELL_CLASS} .tm-status-buttons { display: flex; }
            .${CELL_CLASS} .tm-hidden { visibility: hidden; }
            .tm-guarded .${CELL_CLASS} .tm-button { opacity: 0.4; pointer-events: none; }
            .${CELL_CLASS} .tm-needs-work, .${CELL_CLASS} .tm-approve, .${CELL_CLASS} .tm-decline { padding: 0 8px; }
            .${CELL_CLASS} .tm-needs-work { border-top-right-radius: 0; border-bottom-right-radius: 0; }
            .${CELL_CLASS} .tm-approve { margin-left: 2px; border-top-left-radius: 0; border-bottom-left-radius: 0; }
            .${CELL_CLASS} .tm-needs-work .aui-icon { color: var(--ds-background-warning-bold); }
            .${CELL_CLASS} .tm-needs-work.selected:not(:disabled) { background-color: var(--ds-background-warning-bold); color: var(--ds-text-inverse); }
            .${CELL_CLASS} .tm-needs-work .aui-icon.inverse { color: var(--ds-icon-warning-inverse); }
            .${CELL_CLASS} .tm-approve .aui-icon { color: var(--ds-background-success-bold); }
            .${CELL_CLASS} .tm-approve.selected:not(:disabled) { background-color: var(--ds-background-success-bold); color: var(--ds-text-inverse); }
            .${CELL_CLASS} .tm-approve .aui-icon.inverse { color: var(--ds-surface-sunken); }
            .${CELL_CLASS} .tm-decline .aui-icon { color: var(--ds-background-danger-bold); }
            .${CELL_CLASS} .tm-button:disabled .aui-icon { color: inherit; }
            .${CELL_CLASS} .tm-vetoes { padding: 0 4px; min-width: 46px; color: var(--ds-text-warning-inverse, #172b4d); background: var(--ds-background-warning-bold, #f5cd47); }
            .${CELL_CLASS} .tm-vetoes:hover { background: var(--ds-background-warning-bold-hovered, #e2b203); }
            .${CELL_CLASS} .tm-vetoes:active { background: var(--ds-background-warning-bold-pressed, #cf9f02); }
            .${CELL_CLASS} .tm-veto-count { margin: 0 4px 0 0; }
        `;
        document.head.append(style);
    }
    
    let scheduled = false;
    
    function scheduleScan() {
        if (scheduled) {
            return;
        }
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            scan();
        });
    }
    
    /** The @include only checks the host name; make sure this really is a Bitbucket page. */
    function isBitbucket() {
        return document.querySelector('meta[name="application-name"]')?.content === 'Bitbucket';
    }
    
    function start() {
        addStyles();
        new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true });
        scheduleScan();
    }
    
    if (isBitbucket()) {
        start();
    }
})();
