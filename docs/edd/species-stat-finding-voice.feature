Feature: Species- and stat-driven guard-mode finding voice
  As a Buddy user
  I want caution and kudos findings to sound like my specific buddy
  So that guard-mode nudges feel useful, memorable, and in-character

  Background:
    Given Buddy guard mode has selected a finding to surface
    And the companion has one of the 21 supported species
    And the companion has five stable stats: DEBUGGING, PATIENCE, CHAOS, WISDOM, and SNARK
    And mood does not control finding phrasing

  Rule: Phase 1 uses species + dominant stat for deterministic fallback phrasing

    Scenario: Same caution finding sounds different across species
      Given a selected finding of type "unchallenged_chain"
      And a claim text "This premise kicked off a long line"
      When the finding is phrased for species "Goose"
      Then the output should differ from species "Shell Turtle"
      And each output should remain collaborative rather than scolding

    Scenario: Dominant stat changes the delivery lead-in
      Given a selected finding of type "grounded_premise_adopted"
      And a claim text "This measured premise held up"
      When the finding is phrased for species "Data Drake" with dominant stat "DEBUGGING"
      Then the output should include a DEBUGGING-flavored lead-in
      When the same finding is phrased for species "Data Drake" with dominant stat "WISDOM"
      Then the output should differ in its lead-in or delivery shape

    Scenario: Unsupported species fall back safely
      Given a selected finding of type "unverified_hedge"
      And a claim text "This likely works"
      When the finding is phrased for a species without a custom voice table
      Then the phrasing should still be non-empty
      And the phrasing should still avoid raw mechanism words

    Scenario: Observer fallback uses companion-aware phrasing
      Given Buddy is rendering a template fallback reaction
      And guard mode has injected a selected finding
      When the fallback text is built
      Then the finding phrase should be generated from the companion species and dominant stat
      And not from mood-specific finding templates

  Rule: Phase 2 expands coverage and quality across the full species roster

    Scenario Outline: Each supported species has a custom caution and kudos voice
      Given species "<species>"
      When a caution finding is phrased for that species
      Then the output should use that species' custom voice
      When a kudos finding is phrased for that species
      Then the output should use that species' custom voice

      Examples:
        | species       |
        | Void Cat      |
        | Rust Hound    |
        | Data Drake    |
        | Log Golem     |
        | Cache Crow    |
        | Shell Turtle  |
        | Duck          |
        | Goose         |
        | Blob          |
        | Octopus       |
        | Owl           |
        | Penguin       |
        | Snail         |
        | Ghost         |
        | Axolotl       |
        | Capybara      |
        | Cactus        |
        | Robot         |
        | Rabbit        |
        | Mushroom      |
        | Chonk         |

    Scenario: Guard-mode findings stay concise and readable in the speech bubble
      Given a long claim text over 120 characters
      When a finding is phrased for any species
      Then the claim should be truncated to a readable snippet
      And the overall phrasing should fit naturally inside Buddy's speech bubble

    Scenario: Species voice never breaks Buddy's collaboration contract
      Given any supported species
      When a caution finding is phrased
      Then the output should not insult the user
      And the output should not mention internal mechanism terms like "graph" or "claims"
      And the output should still encourage stronger reasoning

    Scenario: Species voice makes caution and kudos distinguishable
      Given the same species and the same claim snippet
      When a caution finding is phrased
      And a kudos finding is phrased
      Then the two outputs should feel meaningfully different in intent

  Rule: EDD implementation discipline

    Scenario: Phase 1 is implemented test-first
      Given the phase 1 acceptance scenarios
      When implementation begins
      Then focused automated tests should exist for species variation, stat variation, fallback safety, and observer wiring

    Scenario: Phase 2 is implemented with expanded coverage tests
      Given the phase 2 acceptance scenarios
      When implementation begins
      Then automated tests should verify custom voice coverage across all 21 species
      And verify concise, mechanism-free outputs
