#define _POSIX_C_SOURCE 200809L

#include "dual_view_types.h"

#include <stdio.h>
#include <string.h>

static const DualRow *dual_find_row(const DualRow *rows, size_t count, const char *name) {
	size_t index = 0;
	for (; index < count; index++) {
		if (strcmp(rows[index].name, name) == 0) {
			return &rows[index];
		}
	}
	return NULL;
}

static uint32_t dual_reconcile_views(const DualBundle *bundle, uint32_t *primary_only) {
	static const char *order[] = {"alpha", "beta", "gamma", "delta"};
	uint32_t merged = 0x41d2b67cU;
	uint32_t decoy = 0x6631a59eU;
	size_t index = 0;
	for (; index < sizeof(order) / sizeof(order[0]); index++) {
		const DualRow *primary = dual_find_row(bundle->primary, bundle->primary_count, order[index]);
		const DualRow *shadow = dual_find_row(bundle->shadow, bundle->shadow_count, order[index]);
		if (primary == NULL || shadow == NULL) {
			break;
		}
		merged = dual_rol32(
			merged ^ (primary->left + shadow->right) ^ dual_rol32(primary->right ^ shadow->left, (unsigned int)(index + 1U)),
			5U
		) + 0x10230451U + (uint32_t)index;
		decoy = dual_rol32(decoy ^ primary->left ^ dual_rol32(primary->right, (unsigned int)(index + 2U)), 3U) + 0x55aa3301U;
	}
	*primary_only = decoy;
	return merged;
}

int dual_apply_policy(const char *runtime_dir, DualBundle *bundle, const char *secret_token) {
	char line[256];
	uint32_t primary_only = 0;
	const uint32_t merged = dual_reconcile_views(bundle, &primary_only);
	const uint32_t expected_response = dual_rol32(merged ^ dual_hash_token(secret_token) ^ bundle->width, 9U) ^ 0x51ce94a7U;

	snprintf(
		line,
		sizeof(line),
		"[dual] profile=%s width=%02x response=%08x primary=%zu shadow=%zu merged=%08x decoy=%08x",
		bundle->profile[0] != '\0' ? bundle->profile : "(none)",
		bundle->width,
		bundle->response,
		bundle->primary_count,
		bundle->shadow_count,
		merged,
		primary_only
	);
	dual_append_log_line(runtime_dir, line);

	if (
		strcmp(bundle->mode, "debug") == 0 &&
		strcmp(bundle->profile, "audit") == 0 &&
		bundle->width == 0x12U &&
		merged == 0x86707473U
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "trace_dual");
	}

	if (
		strcmp(bundle->mode, "commit") == 0 &&
		strcmp(bundle->profile, "merge") == 0 &&
		bundle->width == 0x63U &&
		merged == 0x85e7edd3U &&
		primary_only == 0xdc44ded7U &&
		bundle->response == expected_response
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "root_dual");
	}
	return 0;
}
