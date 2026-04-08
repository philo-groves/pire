#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

enum PrivLevel { PRIV_GUEST = 0, PRIV_USER = 1, PRIV_ADMIN = 2 };

typedef struct ProxyState {
	char query_name[128];
	char zone_target[64];
	char resolve_mode[16];
	char supplied_token[32];
	char supplied_receipt[32];
	enum PrivLevel level;
	int trace;
} ProxyState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'p' ^ 0x2b, 'r' ^ 0x2b, 'o' ^ 0x2b, 'x' ^ 0x2b, 'y' ^ 0x2b, '-' ^ 0x2b,
	't' ^ 0x2b, 'o' ^ 0x2b, 'k' ^ 0x2b, 'e' ^ 0x2b, 'n' ^ 0x2b, '-' ^ 0x2b,
	'1' ^ 0x2b, '9' ^ 0x2b,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x2b);
	}
	output[index] = '\0';
}

static int ensure_dir(const char *path) {
	if (mkdir(path, 0755) == 0 || errno == EEXIST) {
		return 0;
	}
	perror(path);
	return -1;
}

static int append_log_line(const char *runtime_dir, const char *line) {
	char path[PATH_MAX];
	FILE *log_file = NULL;
	snprintf(path, sizeof(path), "%s/proxy/proxy.log", runtime_dir);
	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{dns-proxy-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x1919UL);
	snprintf(path, sizeof(path), "%s/proxy/proxy.receipt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", receipt);
	fclose(file);
	return 0;
}

static int load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/proxy/proxy.receipt", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(receipt, (int)receipt_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(receipt);
	return 0;
}

/* copy_query uses snprintf into a large buffer — not exploitable */
static void copy_query(ProxyState *state, const char *domain) {
	snprintf(state->query_name, sizeof(state->query_name), "%s", domain);
}

static int process_zone(ProxyState *state, const char *target) {
	if (state->level >= PRIV_USER) {
		snprintf(state->zone_target, sizeof(state->zone_target), "%s", target);
		return 0;
	}
	return -1;
}

static int load_query(const char *query_dir, ProxyState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	snprintf(state->resolve_mode, sizeof(state->resolve_mode), "%s", "local");
	state->level = PRIV_GUEST;
	snprintf(path, sizeof(path), "%s/query.txt", query_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		trim_line(line);
		if (strncmp(line, "AUTH ", 5) == 0) {
			state->level = PRIV_USER;
		} else if (strcmp(line, "TRACE") == 0) {
			state->trace = 1;
		} else if (strncmp(line, "QUERY ", 6) == 0) {
			if (state->level >= PRIV_USER) {
				copy_query(state, line + 6);
			}
		} else if (strncmp(line, "ZONE ", 5) == 0) {
			process_zone(state, line + 5);
		} else if (strncmp(line, "MODE ", 5) == 0) {
			snprintf(state->resolve_mode, sizeof(state->resolve_mode), "%s", line + 5);
		} else if (strncmp(line, "TOKEN ", 6) == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", line + 6);
		} else if (strncmp(line, "RECEIPT ", 8) == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", line + 8);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *query_dir = NULL;
	const char *runtime_dir = "./runtime";
	ProxyState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--query") == 0 && index + 1 < argc) {
			query_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (query_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/proxy", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_query(query_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[proxy] loaded query");
	snprintf(line, sizeof(line), "[proxy] level=%d", state.level);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[proxy] zone=%s", state.zone_target[0] != '\0' ? state.zone_target : "(none)");
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[proxy] mode=%s", state.resolve_mode);
	append_log_line(runtime_dir, line);
	if (state.trace) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[proxy] trace token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[proxy] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.zone_target, "root_zone") == 0 &&
		strcmp(state.resolve_mode, "transfer") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] zone transfer created proof artifact");
		printf("zone transfer completed successfully\n");
		return 0;
	}
	if (strcmp(state.zone_target, "root_zone") == 0) {
		append_log_line(runtime_dir, "[proxy] zone transfer rejected: missing token, receipt, or transfer mode");
	} else {
		append_log_line(runtime_dir, "[proxy] query completed without zone transfer");
	}
	printf("proxy query completed without zone transfer\n");
	return 0;
}
