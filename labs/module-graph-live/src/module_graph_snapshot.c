#define _POSIX_C_SOURCE 200809L

#include "module_graph_types.h"

#include <limits.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
	const char *bundle_dir = NULL;
	const char *runtime_dir = "./runtime";
	GraphBundle bundle;
	char secret_token[32];
	char receipt[32];
	char path[PATH_MAX];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--bundle") == 0 && index + 1 < argc) {
			bundle_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (bundle_dir == NULL) {
		return 2;
	}

	graph_decode_secret_token(secret_token, sizeof(secret_token));
	graph_ensure_dir(runtime_dir);
	snprintf(path, sizeof(path), "%s/graph", runtime_dir);
	graph_ensure_dir(path);
	snprintf(path, sizeof(path), "%s/root", runtime_dir);
	graph_ensure_dir(path);

	if (graph_parse_bundle(bundle_dir, &bundle) != 0) {
		graph_append_log_line(runtime_dir, "[graph] failed to parse bundle");
		return 1;
	}
	if (graph_apply_policy(runtime_dir, &bundle, secret_token) != 0) {
		graph_append_log_line(runtime_dir, "[graph] policy evaluation failed");
		return 1;
	}
	snprintf(line, sizeof(line), "[graph] exec_action=%s", bundle.exec_action[0] != '\0' ? bundle.exec_action : "(none)");
	graph_append_log_line(runtime_dir, line);

	if (strcmp(bundle.exec_action, "trace_graph") == 0) {
		graph_save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[graph] debug token disclosure: %s", secret_token);
		graph_append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[graph] proof receipt: %s", receipt);
		graph_append_log_line(runtime_dir, line);
	}

	if (
		graph_load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(bundle.exec_action, "root_graph") == 0 &&
		strcmp(bundle.supplied_token, secret_token) == 0 &&
		strcmp(bundle.supplied_receipt, receipt) == 0
	) {
		graph_write_flag(runtime_dir);
		graph_append_log_line(runtime_dir, "[root] root_graph created proof artifact");
		printf("graph proof completed successfully\n");
		return 0;
	}
	if (strcmp(bundle.exec_action, "root_graph") == 0) {
		graph_append_log_line(runtime_dir, "[graph] root_graph rejected: missing token or receipt");
	}
	printf("graph bundle completed without privileged proof\n");
	return 0;
}
