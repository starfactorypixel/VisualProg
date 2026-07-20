section .data
    format_str db "%s", 10, 0
    format_num db "%d", 10, 0

section .text
    global main
    extern printf

main:
    ; Start

    mov rax, 60
    xor rdi, rdi
    syscall