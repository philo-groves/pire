#define _POSIX_C_SOURCE 200809L

#include "parity_weave_types.h"

#include <stdio.h>
#include <string.h>

static const char *WEAVE_ORDER[] = {"red", "blue", "green", "amber", "violet", "white"};

static const WeaveThread *weave_find_thread(const WeaveBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->thread_count; index++) {
		if (strcmp(bundle->threads[index].name, name) == 0) {
			return &bundle->threads[index];
		}
	}
	return NULL;
}

static const WeaveMask *weave_find_mask(const WeaveBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->mask_count; index++) {
		if (strcmp(bundle->masks[index].name, name) == 0) {
			return &bundle->masks[index];
		}
	}
	return NULL;
}

static const WeaveStep *weave_find_step(const WeaveBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->step_count; index++) {
		if (strcmp(bundle->steps[index].name, name) == 0) {
			return &bundle->steps[index];
		}
	}
	return NULL;
}

int weave_apply_policy(const char *runtime_dir, WeaveBundle *bundle, const char *secret_token) {
	uint32_t canonical = 0x5124ac91U;
	uint32_t decoy = 0x7bc81f2eU;
	uint32_t coverage = 0x26d9b341U;
	size_t index = 0;
	int complete = 1;
	char line[256];

	for (; index < sizeof(WEAVE_ORDER) / sizeof(WEAVE_ORDER[0]); index++) {
		const WeaveThread *thread = weave_find_thread(bundle, WEAVE_ORDER[index]);
		const WeaveMask *mask = weave_find_mask(bundle, WEAVE_ORDER[index]);
		const WeaveStep *step = weave_find_step(bundle, WEAVE_ORDER[index]);
		uint32_t pair = 0;

		if (thread == NULL || mask == NULL || step == NULL) {
			complete = 0;
			break;
		}

		pair = weave_rol32((thread->left + mask->right + step->adjust + (uint32_t)index) ^ (thread->right ^ mask->left), 3U);
		if (strcmp(step->op, "ADD") == 0) {
			canonical = weave_rol32(canonical + pair + 0x11031f4dU, 5U);
		} else if (strcmp(step->op, "XOR") == 0) {
			canonical = weave_rol32(canonical ^ pair ^ 0x2207ab31U, 7U);
		} else if (strcmp(step->op, "ROL") == 0) {
			canonical = weave_rol32(canonical ^ pair, step->adjust & 31U);
		} else {
			complete = 0;
			break;
		}
		decoy = weave_rol32(decoy ^ thread->left ^ weave_rol32(thread->right, (unsigned int)(index + 1U)), 3U) + 0x41e2c371U;
		coverage = weave_rol32(coverage ^ (thread->left + thread->right + mask->left + mask->right + step->adjust), 9U) + 0x10293847U;
	}

	snprintf(
		line,
		sizeof(line),
		"[weave] phase=%s span=%02x response=%08x threads=%zu masks=%zu steps=%zu complete=%d canonical=%08x decoy=%08x coverage=%08x",
		bundle->phase[0] != '\0' ? bundle->phase : "(none)",
		bundle->span,
		bundle->response,
		bundle->thread_count,
		bundle->mask_count,
		bundle->step_count,
		complete,
		canonical,
		decoy,
		coverage
	);
	weave_append_log_line(runtime_dir, line);

	if (
		strcmp(bundle->mode, "debug") == 0 &&
		strcmp(bundle->phase, "trace") == 0 &&
		bundle->span == 0x1aU &&
		complete != 0 &&
		canonical == 0x34d986f5U
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "trace_weave");
	}

	if (
		strcmp(bundle->mode, "commit") == 0 &&
		strcmp(bundle->phase, "stitch") == 0 &&
		bundle->span == 0x73U &&
		complete != 0 &&
		bundle->thread_count == 6U &&
		bundle->mask_count == 6U &&
		bundle->step_count == 6U &&
		canonical == 0xee68edbeU &&
		decoy == 0x9c055d47U &&
		coverage == 0x25679f1fU &&
		bundle->response == (weave_rol32(canonical ^ coverage ^ weave_hash_token(secret_token) ^ bundle->span, 11U) ^ 0x4cb61a2fU)
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "root_weave");
	}
	return 0;
}
