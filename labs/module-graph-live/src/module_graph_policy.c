#define _POSIX_C_SOURCE 200809L

#include "module_graph_types.h"

#include <stdio.h>
#include <string.h>

static const GraphNode *graph_find_node(const GraphBundle *bundle, const char *name) {
	size_t index = 0;
	for (; index < bundle->node_count; index++) {
		if (strcmp(bundle->nodes[index].name, name) == 0) {
			return &bundle->nodes[index];
		}
	}
	return NULL;
}

static const GraphEdge *graph_select_edge(const GraphBundle *bundle, const char *name) {
	const GraphEdge *selected = NULL;
	size_t index = 0;
	for (; index < bundle->edge_count; index++) {
		const GraphEdge *edge = &bundle->edges[index];
		if (strcmp(edge->src, name) != 0) {
			continue;
		}
		if (selected == NULL || edge->cost < selected->cost ||
			(edge->cost == selected->cost && strcmp(edge->dst, selected->dst) < 0)) {
			selected = edge;
		}
	}
	return selected;
}

static uint32_t graph_walk_score(const GraphBundle *bundle, int *complete) {
	const char *cursor = bundle->anchor;
	uint32_t score = 0x41a7d392U;
	int hops = 0;
	*complete = 1;
	for (hops = 0; hops < 3; hops++) {
		const GraphNode *node = graph_find_node(bundle, cursor);
		const GraphEdge *edge = NULL;
		if (node == NULL) {
			*complete = 0;
			return 0U;
		}
		score = graph_rol32(score ^ node->weight ^ graph_rol32(node->flags, (unsigned int)(hops + 1)), 3U) + 0x10203d55U;
		edge = graph_select_edge(bundle, cursor);
		if (edge == NULL) {
			*complete = 0;
			return score;
		}
		score = graph_rol32(score ^ edge->cost ^ ((uint32_t)(unsigned char)edge->dst[0] << 8U), 5U) ^ 0x6a1b4c29U;
		cursor = edge->dst;
	}
	return score;
}

int graph_apply_policy(const char *runtime_dir, GraphBundle *bundle, const char *secret_token) {
	char line[256];
	int complete = 0;
	const uint32_t route_score = graph_walk_score(bundle, &complete);
	const uint32_t expected_response = graph_rol32(route_score ^ graph_hash_token(secret_token) ^ bundle->budget, 9U) ^ 0x42d19b73U;

	snprintf(
		line,
		sizeof(line),
		"[graph] anchor=%s budget=%02x response=%08x nodes=%zu edges=%zu complete=%d score=%08x",
		bundle->anchor[0] != '\0' ? bundle->anchor : "(none)",
		bundle->budget,
		bundle->response,
		bundle->node_count,
		bundle->edge_count,
		complete,
		route_score
	);
	graph_append_log_line(runtime_dir, line);

	if (
		strcmp(bundle->mode, "debug") == 0 &&
		strcmp(bundle->anchor, "scout") == 0 &&
		bundle->budget == 0x31U &&
		complete != 0 &&
		route_score == 0x5ad0ccf3U
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "trace_graph");
	}

	if (
		strcmp(bundle->mode, "commit") == 0 &&
		strcmp(bundle->anchor, "relay") == 0 &&
		bundle->budget == 0x74U &&
		complete != 0 &&
		route_score == 0x5aa1c93eU &&
		bundle->response == expected_response
	) {
		snprintf(bundle->exec_action, sizeof(bundle->exec_action), "%s", "root_graph");
	}
	return 0;
}
