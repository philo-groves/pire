#ifndef MODULE_GRAPH_TYPES_H
#define MODULE_GRAPH_TYPES_H

#include <stddef.h>
#include <stdint.h>

#define GRAPH_MAX_NODES 8
#define GRAPH_MAX_EDGES 16

typedef struct GraphNode {
	char name[16];
	uint32_t weight;
	uint32_t flags;
} GraphNode;

typedef struct GraphEdge {
	char src[16];
	char dst[16];
	uint32_t cost;
} GraphEdge;

typedef struct GraphBundle {
	char mode[16];
	char anchor[16];
	uint32_t budget;
	uint32_t response;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[24];
	GraphNode nodes[GRAPH_MAX_NODES];
	GraphEdge edges[GRAPH_MAX_EDGES];
	size_t node_count;
	size_t edge_count;
} GraphBundle;

char *graph_trim_line(char *line);
uint32_t graph_rol32(uint32_t value, unsigned int shift);
uint32_t graph_hash_token(const char *token);
void graph_decode_secret_token(char *output, size_t output_size);
int graph_ensure_dir(const char *path);
int graph_append_log_line(const char *runtime_dir, const char *line);
int graph_write_flag(const char *runtime_dir);
int graph_save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int graph_load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int graph_load_auth(const char *bundle_dir, GraphBundle *bundle);
int graph_parse_bundle(const char *bundle_dir, GraphBundle *bundle);
int graph_apply_policy(const char *runtime_dir, GraphBundle *bundle, const char *secret_token);

#endif
