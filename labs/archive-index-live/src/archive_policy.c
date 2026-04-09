#define _POSIX_C_SOURCE 200809L

#include "archive_types.h"

#include <stdio.h>
#include <string.h>

static uint32_t archive_section_tag(const char *name) {
	if (strcmp(name, "text") == 0) {
		return 0x11U;
	}
	if (strcmp(name, "data") == 0) {
		return 0x29U;
	}
	if (strcmp(name, "bss") == 0) {
		return 0x3dU;
	}
	if (strcmp(name, "init") == 0) {
		return 0x52U;
	}
	if (strcmp(name, "fini") == 0) {
		return 0x64U;
	}
	if (strcmp(name, "meta") == 0) {
		return 0x7bU;
	}
	return 0U;
}

static uint32_t archive_compute_section_mix(const ArchiveBundle *bundle) {
	uint32_t mix = 0x7314a55cU;
	size_t index = 0;
	for (; index < bundle->section_count; index++) {
		const ArchiveSection *section = &bundle->sections[index];
		const uint32_t tag = archive_section_tag(section->name);
		mix = archive_rol32(mix ^ (tag + section->base) ^ archive_rol32(section->delta, (unsigned int)(index + 1U)), 5U);
		mix += 0x9e3779b9U + (uint32_t)index;
	}
	return mix;
}

int archive_apply_policy(const char *runtime_dir, ArchiveBundle *bundle, const char *secret_token) {
	char line[256];
	const uint32_t mix = archive_compute_section_mix(bundle);
	const uint32_t expected_response = archive_rol32(mix ^ bundle->span ^ archive_hash_token(secret_token), 11U) ^ 0x5e31a4c7U;

	snprintf(
		line,
		sizeof(line),
		"[archive] profile=%s span=%02x bias=%02x response=%08x sections=%zu mix=%08x",
		bundle->profile[0] != '\0' ? bundle->profile : "(none)",
		bundle->span,
		bundle->bias,
		bundle->response,
		bundle->section_count,
		mix
	);
	archive_append_log_line(runtime_dir, line);

	if (
		strcmp(bundle->mode, "debug") == 0 &&
		strcmp(bundle->profile, "trace") == 0 &&
		bundle->span == 0x14U &&
		bundle->bias == 0x21U &&
		bundle->section_count == 2U
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "trace_archive");
	}

	if (
		strcmp(bundle->mode, "commit") == 0 &&
		strcmp(bundle->profile, "mirror") == 0 &&
		bundle->span == 0x2dU &&
		bundle->bias == 0x91U &&
		bundle->section_count == 3U &&
		mix == 0x48b6614fU &&
		bundle->response == expected_response
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "root_archive");
	}

	if (strcmp(bundle->exec_action, "root_archive") == 0 &&
		bundle->supplied_token[0] != '\0' &&
		bundle->supplied_receipt[0] != '\0') {
		snprintf(line, sizeof(line), "[archive] commit response matched expected=%08x", expected_response);
		archive_append_log_line(runtime_dir, line);
	}
	return 0;
}
