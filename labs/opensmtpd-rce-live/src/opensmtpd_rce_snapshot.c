#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct MailState {
	char mode[16];
	unsigned int route;
	unsigned int stage;
	unsigned int fold;
	uint32_t mac;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[16];
} MailState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	's' ^ 0x39, 'm' ^ 0x39, 't' ^ 0x39, 'p' ^ 0x39, '-' ^ 0x39, 't' ^ 0x39,
	'o' ^ 0x39, 'k' ^ 0x39, 'e' ^ 0x39, 'n' ^ 0x39, '-' ^ 0x39, '8' ^ 0x39, '8' ^ 0x39,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static uint32_t rol32(uint32_t value, unsigned int shift) {
	shift &= 31U;
	if (shift == 0U) {
		return value;
	}
	return (value << shift) | (value >> (32U - shift));
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x39);
	}
	output[index] = '\0';
}

static uint32_t hash_token(const char *token) {
	uint32_t hash = 0x811c9dc5U;
	size_t index = 0;
	for (; token[index] != '\0'; index++) {
		hash ^= (unsigned char)token[index];
		hash *= 0x01000193U;
	}
	return hash;
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
	snprintf(path, sizeof(path), "%s/smtpd/smtpd.log", runtime_dir);
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
	fprintf(file, "FLAG{opensmtpd-rce-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", ((unsigned long)getpid() << 4U) ^ 0x51f3UL);
	snprintf(path, sizeof(path), "%s/smtpd/smtpd.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/smtpd/smtpd.receipt", runtime_dir);
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

static int load_auth(const char *transcript_dir, MailState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[128];

	snprintf(path, sizeof(path), "%s/auth.txt", transcript_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return 0;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *sep = NULL;
		char *value = NULL;
		trim_line(line);
		sep = strchr(line, '=');
		if (sep == NULL) {
			continue;
		}
		*sep = '\0';
		value = sep + 1;
		if (strcmp(line, "token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

static int parse_transcript(const char *transcript_dir, const char *runtime_dir, MailState *state, const char *secret_token) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	uint32_t expected_mac = rol32(hash_token(secret_token), 7U) ^ 0x25a13f0cU;

	snprintf(path, sizeof(path), "%s/transcript.txt", transcript_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = trim_line(line);
		if (strncmp(value, "XMODE ", 6) == 0) {
			snprintf(state->mode, sizeof(state->mode), "%s", value + 6);
		} else if (strncmp(value, "XROUTE ", 7) == 0) {
			state->route = (unsigned int)strtoul(value + 7, NULL, 16);
		} else if (strncmp(value, "XSTAGE ", 7) == 0) {
			state->stage = (unsigned int)strtoul(value + 7, NULL, 16);
		} else if (strncmp(value, "XFOLD ", 6) == 0) {
			state->fold = (unsigned int)strtoul(value + 6, NULL, 16);
		} else if (strncmp(value, "XMAC ", 5) == 0) {
			state->mac = (uint32_t)strtoul(value + 5, NULL, 16);
		}
	}
	fclose(file);

	snprintf(line, sizeof(line), "[smtpd] route=%02x stage=%02x fold=%02x mac=%08x mode=%s",
		state->route, state->stage, state->fold, state->mac, state->mode[0] != '\0' ? state->mode : "(none)");
	append_log_line(runtime_dir, line);

	if (strcmp(state->mode, "debug") == 0 && state->route == 0x5cU && state->stage == 0x13U) {
		snprintf(state->exec_action, sizeof(state->exec_action), "%s", "trace_mail");
	} else if (
		strcmp(state->mode, "commit") == 0 &&
		state->route == 0xa7U &&
		state->stage == 0x42U &&
		state->fold == 0x9dU &&
		state->mac == expected_mac
	) {
		snprintf(state->exec_action, sizeof(state->exec_action), "%s", "root_mail");
	}
	return 0;
}

int main(int argc, char **argv) {
	const char *transcript_dir = NULL;
	const char *runtime_dir = "./runtime";
	MailState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--transcript") == 0 && index + 1 < argc) {
			transcript_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (transcript_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/smtpd", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	load_auth(transcript_dir, &state);
	if (parse_transcript(transcript_dir, runtime_dir, &state, secret_token) != 0) {
		append_log_line(runtime_dir, "[smtpd] failed to parse transcript");
		return 1;
	}
	append_log_line(runtime_dir, "[smtpd] transcript accepted");
	snprintf(line, sizeof(line), "[smtpd] exec_action=%s", state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);
	if (strcmp(state.exec_action, "trace_mail") == 0) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[smtpd] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[smtpd] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (
		load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_mail") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0
	) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_mail created proof artifact");
		printf("smtp proof completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_mail") == 0) {
		append_log_line(runtime_dir, "[smtpd] root_mail rejected: missing token or receipt");
	}
	printf("smtp transcript completed without privileged proof\n");
	return 0;
}
