#define _POSIX_C_SOURCE 200809L

#include "module_graph_types.h"

#include <ctype.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int graph_parse_u32_hex(const char *text, uint32_t *value) {
	char *endptr = NULL;
	unsigned long parsed = strtoul(text, &endptr, 16);
	if (endptr == text || *endptr != '\0' || parsed > 0xffffffffUL) {
		return -1;
	}
	*value = (uint32_t)parsed;
	return 0;
}

static int graph_parse_request(const char *bundle_dir, GraphBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/request.ini", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *sep = strchr(line, '=');
		char *value = NULL;
		graph_trim_line(line);
		if (sep == NULL) {
			continue;
		}
		*sep = '\0';
		value = sep + 1;
		if (strcmp(line, "mode") == 0) {
			snprintf(bundle->mode, sizeof(bundle->mode), "%s", value);
		} else if (strcmp(line, "anchor") == 0) {
			snprintf(bundle->anchor, sizeof(bundle->anchor), "%s", value);
		} else if (strcmp(line, "budget") == 0) {
			if (graph_parse_u32_hex(value, &bundle->budget) != 0) {
				fclose(file);
				return -1;
			}
		} else if (strcmp(line, "response") == 0) {
			if (graph_parse_u32_hex(value, &bundle->response) != 0) {
				fclose(file);
				return -1;
			}
		}
	}
	fclose(file);
	return 0;
}

static int graph_parse_nodes(const char *bundle_dir, GraphBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/nodes.tbl", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char name[16];
		char weight_text[32];
		char flags_text[32];
		size_t index = 0;

		if (bundle->node_count >= GRAPH_MAX_NODES) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %31s %31s", name, weight_text, flags_text) != 3) {
			fclose(file);
			return -1;
		}
		for (; name[index] != '\0'; index++) {
			if (!isalpha((unsigned char)name[index])) {
				fclose(file);
				return -1;
			}
		}
		snprintf(bundle->nodes[bundle->node_count].name, sizeof(bundle->nodes[bundle->node_count].name), "%s", name);
		if (graph_parse_u32_hex(weight_text, &bundle->nodes[bundle->node_count].weight) != 0 ||
			graph_parse_u32_hex(flags_text, &bundle->nodes[bundle->node_count].flags) != 0) {
			fclose(file);
			return -1;
		}
		bundle->node_count += 1U;
	}
	fclose(file);
	return 0;
}

static int graph_parse_edges(const char *bundle_dir, GraphBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/edges.tbl", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char src[16];
		char dst[16];
		char cost_text[32];
		if (bundle->edge_count >= GRAPH_MAX_EDGES) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %15s %31s", src, dst, cost_text) != 3) {
			fclose(file);
			return -1;
		}
		snprintf(bundle->edges[bundle->edge_count].src, sizeof(bundle->edges[bundle->edge_count].src), "%s", src);
		snprintf(bundle->edges[bundle->edge_count].dst, sizeof(bundle->edges[bundle->edge_count].dst), "%s", dst);
		if (graph_parse_u32_hex(cost_text, &bundle->edges[bundle->edge_count].cost) != 0) {
			fclose(file);
			return -1;
		}
		bundle->edge_count += 1U;
	}
	fclose(file);
	return 0;
}

int graph_parse_bundle(const char *bundle_dir, GraphBundle *bundle) {
	memset(bundle, 0, sizeof(*bundle));
	if (graph_parse_request(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (graph_parse_nodes(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (graph_parse_edges(bundle_dir, bundle) != 0) {
		return -1;
	}
	return graph_load_auth(bundle_dir, bundle);
}
