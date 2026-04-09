#define _POSIX_C_SOURCE 200809L

#include "symbol_relay_types.h"

#include <stdio.h>
#include <string.h>

static const RelaySymbol *relay_find_symbol(const RelayBundle *bundle, const char *alias) {
	size_t index = 0;
	for (; index < bundle->symbol_count; index++) {
		if (strcmp(bundle->symbols[index].alias, alias) == 0) {
			return &bundle->symbols[index];
		}
	}
	return NULL;
}

static uint32_t relay_class_tag(const char *class_name) {
	if (strcmp(class_name, "core") == 0) {
		return 0x19U;
	}
	if (strcmp(class_name, "aux") == 0) {
		return 0x27U;
	}
	if (strcmp(class_name, "shim") == 0) {
		return 0x35U;
	}
	if (strcmp(class_name, "late") == 0) {
		return 0x4bU;
	}
	return 0U;
}

static uint32_t relay_run_plan(const RelayBundle *bundle, int *complete) {
	uint32_t state = 0x7a11d4e3U;
	size_t index = 0;
	*complete = 1;
	for (; index < bundle->step_count; index++) {
		const RelayStep *step = &bundle->steps[index];
		const RelaySymbol *symbol = relay_find_symbol(bundle, step->alias);
		const uint32_t class_tag = symbol == NULL ? 0U : relay_class_tag(symbol->class_name);
		if (symbol == NULL || class_tag == 0U) {
			*complete = 0;
			return state;
		}
		if (strcmp(step->op, "ADD") == 0) {
			state = relay_rol32(state + symbol->value + step->adjust + class_tag, 3U);
		} else if (strcmp(step->op, "XOR") == 0) {
			state = relay_rol32(state ^ symbol->value ^ step->adjust ^ class_tag, 5U);
		} else if (strcmp(step->op, "ROL") == 0) {
			state = relay_rol32(state ^ symbol->value ^ class_tag, step->adjust & 31U);
		} else {
			*complete = 0;
			return state;
		}
		state ^= 0x10293847U + (uint32_t)index;
	}
	return state;
}

int relay_apply_policy(const char *runtime_dir, RelayBundle *bundle, const char *secret_token) {
	char line[256];
	int complete = 0;
	const uint32_t relay_state = relay_run_plan(bundle, &complete);
	const uint32_t expected_response = relay_rol32(relay_state ^ relay_hash_token(secret_token) ^ bundle->window ^ bundle->salt, 7U) ^ 0x51a8d36cU;

	snprintf(
		line,
		sizeof(line),
		"[relay] window=%02x salt=%02x response=%08x symbols=%zu steps=%zu complete=%d state=%08x",
		bundle->window,
		bundle->salt,
		bundle->response,
		bundle->symbol_count,
		bundle->step_count,
		complete,
		relay_state
	);
	relay_append_log_line(runtime_dir, line);

	if (
		strcmp(bundle->mode, "debug") == 0 &&
		bundle->window == 0x18U &&
		bundle->salt == 0x33U &&
		complete != 0 &&
		relay_state == 0x04db3670U
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "trace_relay");
	}

	if (
		strcmp(bundle->mode, "commit") == 0 &&
		bundle->window == 0x47U &&
		bundle->salt == 0xa2U &&
		complete != 0 &&
		relay_state == 0x6c9215deU &&
		bundle->response == expected_response
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "root_relay");
	}
	return 0;
}
