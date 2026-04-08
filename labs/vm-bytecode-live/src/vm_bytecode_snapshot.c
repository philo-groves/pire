#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_PROGRAM_BYTES 512

typedef struct VmState {
	uint32_t regs[4];
	int debug;
	char exec_action[16];
	char supplied_token[32];
	char supplied_receipt[32];
} VmState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'v' ^ 0x34, 'm' ^ 0x34, '-' ^ 0x34, 't' ^ 0x34, 'o' ^ 0x34, 'k' ^ 0x34,
	'e' ^ 0x34, 'n' ^ 0x34, '-' ^ 0x34, '4' ^ 0x34, '2' ^ 0x34,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x34);
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
	snprintf(path, sizeof(path), "%s/vm/vm.log", runtime_dir);
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
	fprintf(file, "FLAG{vm-bytecode-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x5b5bUL);
	snprintf(path, sizeof(path), "%s/vm/vm.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/vm/vm.receipt", runtime_dir);
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

static int load_auth(const char *program_dir, VmState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[128];

	snprintf(path, sizeof(path), "%s/auth.txt", program_dir);
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

static int parse_hex_byte(const char *token, uint8_t *value) {
	char *endptr = NULL;
	unsigned long parsed = 0;
	parsed = strtoul(token, &endptr, 16);
	if (endptr == token || *endptr != '\0' || parsed > 0xffUL) {
		return -1;
	}
	*value = (uint8_t)parsed;
	return 0;
}

static size_t load_program(const char *program_dir, uint8_t *program, size_t capacity) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	size_t length = 0;

	snprintf(path, sizeof(path), "%s/program.hex", program_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return 0;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *cursor = line;
		while (*cursor != '\0') {
			char token[8];
			size_t token_length = 0;
			uint8_t value = 0;
			while (*cursor != '\0' && isspace((unsigned char)*cursor)) {
				cursor++;
			}
			if (*cursor == '\0') {
				break;
			}
			while (*cursor != '\0' && !isspace((unsigned char)*cursor) && token_length + 1 < sizeof(token)) {
				token[token_length++] = *cursor++;
			}
			token[token_length] = '\0';
			if (parse_hex_byte(token, &value) != 0) {
				fclose(file);
				return 0;
			}
			if (length >= capacity) {
				fclose(file);
				return 0;
			}
			program[length++] = value;
		}
	}
	fclose(file);
	return length;
}

static uint32_t read_u32_le(const uint8_t *program, size_t *pc, size_t length) {
	uint32_t value = 0;
	if (*pc + 4 > length) {
		return 0;
	}
	value = (uint32_t)program[*pc] |
		((uint32_t)program[*pc + 1] << 8U) |
		((uint32_t)program[*pc + 2] << 16U) |
		((uint32_t)program[*pc + 3] << 24U);
	*pc += 4;
	return value;
}

static int execute_program(const char *runtime_dir, const uint8_t *program, size_t length, VmState *state, const char *secret_token) {
	size_t pc = 0;
	uint32_t hash = hash_token(secret_token);
	uint32_t expected0 = rol32(hash ^ 0x13579bdfU, 5U);
	uint32_t expected1 = (hash + 0x2468ace1U) ^ 0xa5a55a5aU;
	uint32_t expected2 = rol32(hash ^ 0xfeed1234U, 13U);
	char line[256];

	while (pc < length) {
		uint8_t opcode = program[pc++];
		switch (opcode) {
			case 0x10: {
				uint8_t reg = 0;
				uint8_t imm = 0;
				if (pc + 2 > length) return -1;
				reg = program[pc++] & 3U;
				imm = program[pc++];
				state->regs[reg] = imm;
				break;
			}
			case 0x11: {
				uint8_t reg = 0;
				uint8_t imm = 0;
				if (pc + 2 > length) return -1;
				reg = program[pc++] & 3U;
				imm = program[pc++];
				state->regs[reg] ^= imm;
				break;
			}
			case 0x12: {
				uint8_t reg = 0;
				uint8_t imm = 0;
				if (pc + 2 > length) return -1;
				reg = program[pc++] & 3U;
				imm = program[pc++];
				state->regs[reg] += imm;
				break;
			}
			case 0x13: {
				uint8_t reg = 0;
				uint8_t imm = 0;
				if (pc + 2 > length) return -1;
				reg = program[pc++] & 3U;
				imm = program[pc++];
				state->regs[reg] = rol32(state->regs[reg], imm & 31U);
				break;
			}
			case 0x14: {
				uint8_t dst = 0;
				uint8_t src = 0;
				if (pc + 2 > length) return -1;
				dst = program[pc++] & 3U;
				src = program[pc++] & 3U;
				state->regs[dst] = rol32(state->regs[dst] ^ (state->regs[src] + 0x9e3779b9U), (src + 3U) & 31U);
				break;
			}
			case 0x15: {
				uint8_t dst = 0;
				uint8_t src = 0;
				if (pc + 2 > length) return -1;
				dst = program[pc++] & 3U;
				src = program[pc++] & 3U;
				state->regs[dst] = state->regs[dst] * 33U + state->regs[src] + 0x45U;
				break;
			}
			case 0x16: {
				uint8_t reg = 0;
				uint32_t imm = 0;
				if (pc + 5 > length) return -1;
				reg = program[pc++] & 3U;
				imm = read_u32_le(program, &pc, length);
				state->regs[reg] = imm;
				break;
			}
			case 0x17: {
				uint8_t reg = 0;
				uint32_t imm = 0;
				if (pc + 5 > length) return -1;
				reg = program[pc++] & 3U;
				imm = read_u32_le(program, &pc, length);
				state->regs[reg] ^= imm;
				break;
			}
			case 0x30:
				state->debug = 1;
				break;
			case 0x7e:
				if (state->regs[0] == expected0 && state->regs[1] == expected1 && state->regs[2] == expected2) {
					snprintf(state->exec_action, sizeof(state->exec_action), "%s", "root_vm");
				}
				break;
			default:
				snprintf(line, sizeof(line), "[vm] invalid opcode 0x%02x at pc=%zu", opcode, pc - 1);
				append_log_line(runtime_dir, line);
				return -1;
		}
	}
	snprintf(line, sizeof(line), "[vm] regs=%08x,%08x,%08x,%08x",
		state->regs[0], state->regs[1], state->regs[2], state->regs[3]);
	append_log_line(runtime_dir, line);
	return 0;
}

int main(int argc, char **argv) {
	const char *program_dir = NULL;
	const char *runtime_dir = "./runtime";
	VmState state;
	uint8_t program[MAX_PROGRAM_BYTES];
	size_t program_length = 0;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--program") == 0 && index + 1 < argc) {
			program_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (program_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/vm", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	load_auth(program_dir, &state);
	program_length = load_program(program_dir, program, sizeof(program));
	if (program_length == 0U) {
		append_log_line(runtime_dir, "[vm] failed to load program bytes");
		return 1;
	}
	if (execute_program(runtime_dir, program, program_length, &state, secret_token) != 0) {
		printf("vm execution failed\n");
		return 1;
	}
	append_log_line(runtime_dir, "[vm] execution complete");
	snprintf(line, sizeof(line), "[vm] exec_action=%s", state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[vm] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[vm] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_vm") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_vm created proof artifact");
		printf("vm proof completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_vm") == 0) {
		append_log_line(runtime_dir, "[vm] root_vm rejected: missing token or receipt");
	}
	printf("vm execution completed without privileged proof\n");
	return 0;
}
