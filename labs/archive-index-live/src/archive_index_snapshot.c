#define _POSIX_C_SOURCE 200809L

#include "archive_types.h"

#include <limits.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
	const char *bundle_dir = NULL;
	const char *runtime_dir = "./runtime";
	ArchiveBundle bundle;
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

	archive_decode_secret_token(secret_token, sizeof(secret_token));
	archive_ensure_dir(runtime_dir);
	snprintf(path, sizeof(path), "%s/archive", runtime_dir);
	archive_ensure_dir(path);
	snprintf(path, sizeof(path), "%s/root", runtime_dir);
	archive_ensure_dir(path);

	if (archive_parse_bundle(bundle_dir, &bundle) != 0) {
		archive_append_log_line(runtime_dir, "[archive] failed to parse bundle");
		return 1;
	}
	if (archive_apply_policy(runtime_dir, &bundle, secret_token) != 0) {
		archive_append_log_line(runtime_dir, "[archive] policy evaluation failed");
		return 1;
	}
	snprintf(line, sizeof(line), "[archive] exec_action=%s", bundle.exec_action[0] != '\0' ? bundle.exec_action : "(none)");
	archive_append_log_line(runtime_dir, line);

	if (strcmp(bundle.exec_action, "trace_archive") == 0) {
		archive_save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[archive] debug token disclosure: %s", secret_token);
		archive_append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[archive] proof receipt: %s", receipt);
		archive_append_log_line(runtime_dir, line);
	}

	if (
		archive_load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(bundle.exec_action, "root_archive") == 0 &&
		strcmp(bundle.supplied_token, secret_token) == 0 &&
		strcmp(bundle.supplied_receipt, receipt) == 0
	) {
		archive_write_flag(runtime_dir);
		archive_append_log_line(runtime_dir, "[root] root_archive created proof artifact");
		printf("archive proof completed successfully\n");
		return 0;
	}
	if (strcmp(bundle.exec_action, "root_archive") == 0) {
		archive_append_log_line(runtime_dir, "[archive] root_archive rejected: missing token or receipt");
	}
	printf("archive bundle completed without privileged proof\n");
	return 0;
}
