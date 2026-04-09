#define _POSIX_C_SOURCE 200809L

#include "symbol_relay_types.h"

#include <limits.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
	const char *bundle_dir = NULL;
	const char *runtime_dir = "./runtime";
	RelayBundle bundle;
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

	relay_decode_secret_token(secret_token, sizeof(secret_token));
	relay_ensure_dir(runtime_dir);
	snprintf(path, sizeof(path), "%s/relay", runtime_dir);
	relay_ensure_dir(path);
	snprintf(path, sizeof(path), "%s/root", runtime_dir);
	relay_ensure_dir(path);

	if (relay_parse_bundle(bundle_dir, &bundle) != 0) {
		relay_append_log_line(runtime_dir, "[relay] failed to parse bundle");
		return 1;
	}
	if (relay_apply_policy(runtime_dir, &bundle, secret_token) != 0) {
		relay_append_log_line(runtime_dir, "[relay] policy evaluation failed");
		return 1;
	}
	snprintf(line, sizeof(line), "[relay] exec_action=%s", bundle.exec_action[0] != '\0' ? bundle.exec_action : "(none)");
	relay_append_log_line(runtime_dir, line);

	if (strcmp(bundle.exec_action, "trace_relay") == 0) {
		relay_save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[relay] debug token disclosure: %s", secret_token);
		relay_append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[relay] proof receipt: %s", receipt);
		relay_append_log_line(runtime_dir, line);
	}

	if (
		relay_load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(bundle.exec_action, "root_relay") == 0 &&
		strcmp(bundle.supplied_token, secret_token) == 0 &&
		strcmp(bundle.supplied_receipt, receipt) == 0
	) {
		relay_write_flag(runtime_dir);
		relay_append_log_line(runtime_dir, "[root] root_relay created proof artifact");
		printf("relay proof completed successfully\n");
		return 0;
	}
	if (strcmp(bundle.exec_action, "root_relay") == 0) {
		relay_append_log_line(runtime_dir, "[relay] root_relay rejected: missing token or receipt");
	}
	printf("relay bundle completed without privileged proof\n");
	return 0;
}
