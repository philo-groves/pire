#define _POSIX_C_SOURCE 200809L

#include "ledger_lock_types.h"

#include <stdio.h>
#include <string.h>

static const char *LEDGER_ORDER[] = {"gate", "vault", "relay", "hinge", "crown"};

static const LedgerAccount *ledger_find_account(const LedgerBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->account_count; index++) {
		if (strcmp(bundle->accounts[index].name, name) == 0) {
			return &bundle->accounts[index];
		}
	}
	return NULL;
}

static const LedgerLink *ledger_find_link(const LedgerBundle *bundle, const char *from) {
	size_t index = 0;
	for (; index < bundle->link_count; index++) {
		if (strcmp(bundle->links[index].from, from) == 0) {
			return &bundle->links[index];
		}
	}
	return NULL;
}

static const LedgerStep *ledger_find_step(const LedgerBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->step_count; index++) {
		if (strcmp(bundle->steps[index].name, name) == 0) {
			return &bundle->steps[index];
		}
	}
	return NULL;
}

int ledger_apply_policy(const char *runtime_dir, LedgerBundle *bundle, const char *secret_token) {
	uint32_t canonical = 0x39b41d6eU;
	uint32_t local = 0x6ca812f3U;
	uint32_t closure = 0x17d3429aU;
	size_t index = 0;
	int complete = 1;
	char line[256];

	for (; index < sizeof(LEDGER_ORDER) / sizeof(LEDGER_ORDER[0]); index++) {
		const LedgerAccount *account = ledger_find_account(bundle, LEDGER_ORDER[index]);
		const LedgerLink *link = ledger_find_link(bundle, LEDGER_ORDER[index]);
		const LedgerStep *step = ledger_find_step(bundle, LEDGER_ORDER[index]);
		const LedgerAccount *next = NULL;
		uint32_t mix = 0;

		if (account == NULL || link == NULL || step == NULL) {
			complete = 0;
			break;
		}
		next = ledger_find_account(bundle, link->to);
		if (next == NULL) {
			complete = 0;
			break;
		}

		mix = ledger_rol32(account->value + next->tag + link->weight + step->adjust + (uint32_t)index, 4U);
		if (strcmp(step->op, "ADD") == 0) {
			canonical = ledger_rol32(canonical + mix + 0x211f4b3dU, 5U);
		} else if (strcmp(step->op, "XOR") == 0) {
			canonical = ledger_rol32(canonical ^ mix ^ 0x53a12c47U, 7U);
		} else if (strcmp(step->op, "ROL") == 0) {
			canonical = ledger_rol32(canonical ^ mix, step->adjust & 31U);
		} else {
			complete = 0;
			break;
		}

		local = ledger_rol32(local ^ account->value ^ account->tag ^ step->adjust, 3U) + 0x3d26718fU;
		closure = ledger_rol32(closure ^ (account->value + next->value + link->weight + next->tag), 9U) + 0x10219b75U;
	}

	snprintf(
		line,
		sizeof(line),
		"[ledger] phase=%s window=%02x response=%08x accounts=%zu links=%zu steps=%zu complete=%d canonical=%08x local=%08x closure=%08x",
		bundle->phase[0] != '\0' ? bundle->phase : "(none)",
		bundle->window,
		bundle->response,
		bundle->account_count,
		bundle->link_count,
		bundle->step_count,
		complete,
		canonical,
		local,
		closure
	);
	ledger_append_log_line(runtime_dir, line);

	if (
		strcmp(bundle->mode, "debug") == 0 &&
		strcmp(bundle->phase, "trace") == 0 &&
		bundle->window == 0x19U &&
		complete != 0 &&
		canonical == 0xa14ef68cU
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "trace_ledger");
	}

	if (
		strcmp(bundle->mode, "commit") == 0 &&
		strcmp(bundle->phase, "seal") == 0 &&
		bundle->window == 0x61U &&
		complete != 0 &&
		bundle->account_count == 5U &&
		bundle->link_count == 5U &&
		bundle->step_count == 5U &&
		canonical == 0xada6a69bU &&
		local == 0x2d5fc630U &&
		closure == 0xf8618749U &&
		bundle->response == (ledger_rol32(canonical ^ closure ^ ledger_hash_token(secret_token) ^ bundle->window, 13U) ^ 0x7a51c2e3U)
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "root_ledger");
	}
	return 0;
}
