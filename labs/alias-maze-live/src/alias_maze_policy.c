#define _POSIX_C_SOURCE 200809L

#include "alias_maze_types.h"

#include <stdio.h>
#include <string.h>

static const MazeBase *maze_find_base(const MazeBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->base_count; index++) {
		if (strcmp(bundle->bases[index].name, name) == 0) {
			return &bundle->bases[index];
		}
	}
	return NULL;
}

static const char *maze_follow_once(const MazeBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->alias_count; index++) {
		if (strcmp(bundle->aliases[index].alias, name) == 0) {
			return bundle->aliases[index].target;
		}
	}
	return NULL;
}

static const MazeBase *maze_resolve_canonical(const MazeBundle *bundle, const char *name) {
	const char *cursor = name;
	int hops = 0;
	while (hops < 6) {
		const MazeBase *base = maze_find_base(bundle, cursor);
		const char *next = NULL;
		if (base != NULL) {
			return base;
		}
		next = maze_follow_once(bundle, cursor);
		if (next == NULL) {
			return NULL;
		}
		cursor = next;
		hops += 1;
	}
	return NULL;
}

static const MazeBase *maze_resolve_decoy(const MazeBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->alias_count; index++) {
		if (strcmp(bundle->aliases[index].alias, name) == 0) {
			return maze_find_base(bundle, bundle->aliases[index].target);
		}
	}
	return maze_find_base(bundle, name);
}

int maze_apply_policy(const char *runtime_dir, MazeBundle *bundle, const char *secret_token) {
	char line[256];
	uint32_t canonical = 0x6f31c2a9U;
	uint32_t decoy = 0x4b12d6ceU;
	size_t index = 0;
	int complete = 1;

	for (; index < bundle->step_count; index++) {
		const MazeStep *step = &bundle->steps[index];
		const MazeBase *resolved = maze_resolve_canonical(bundle, step->alias);
		const MazeBase *near = maze_resolve_decoy(bundle, step->alias);
		if (resolved == NULL || near == NULL) {
			complete = 0;
			break;
		}
		if (strcmp(step->op, "ADD") == 0) {
			canonical = maze_rol32(canonical + resolved->value + step->adjust + resolved->class_tag, 3U);
			decoy = maze_rol32(decoy + near->value + step->adjust + near->class_tag, 2U);
		} else if (strcmp(step->op, "XOR") == 0) {
			canonical = maze_rol32(canonical ^ resolved->value ^ step->adjust ^ resolved->class_tag, 5U);
			decoy = maze_rol32(decoy ^ near->value ^ step->adjust ^ near->class_tag, 4U);
		} else if (strcmp(step->op, "ROL") == 0) {
			canonical = maze_rol32(canonical ^ resolved->value ^ resolved->class_tag, step->adjust & 31U);
			decoy = maze_rol32(decoy ^ near->value ^ near->class_tag, (step->adjust + 1U) & 31U);
		} else {
			complete = 0;
			break;
		}
		canonical ^= 0x10019c53U + (uint32_t)index;
		decoy ^= 0x31a7b204U + (uint32_t)index;
	}

	snprintf(
		line,
		sizeof(line),
		"[maze] window=%02x response=%08x bases=%zu aliases=%zu steps=%zu complete=%d canonical=%08x decoy=%08x",
		bundle->window,
		bundle->response,
		bundle->base_count,
		bundle->alias_count,
		bundle->step_count,
		complete,
		canonical,
		decoy
	);
	maze_append_log_line(runtime_dir, line);

	if (
		strcmp(bundle->mode, "debug") == 0 &&
		bundle->window == 0x1cU &&
		complete != 0 &&
		canonical == 0xec48fa3eU
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "trace_maze");
	}

	if (
		strcmp(bundle->mode, "commit") == 0 &&
		bundle->window == 0x57U &&
		complete != 0 &&
		canonical == 0x991ece4aU &&
		decoy == 0xe76d28eaU &&
		bundle->response == (maze_rol32(canonical ^ maze_hash_token(secret_token) ^ bundle->window, 11U) ^ 0x63a18db4U)
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "root_maze");
	}
	return 0;
}
